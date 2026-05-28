import json
import os
import re
import threading
from collections import deque

from google import genai
from dotenv import load_dotenv
from flask import Flask, request, jsonify

from ha_client import HAClient
from intent_engine import IntentEngine

load_dotenv()

HA_TOKEN = os.environ["HA_TOKEN"]
HA_BASE_URL = os.environ["HA_BASE_URL"]

app = Flask(__name__)

_ha = HAClient(base_url=HA_BASE_URL, token=HA_TOKEN)

with open(os.path.join(os.path.dirname(__file__), "people.json")) as f:
    _people = json.load(f)

engine = IntentEngine(client=_ha, people=_people)

session_history: deque = deque(maxlen=5)

_KEY_ENTITIES = [
    "lock.main_door",
    "cover.double",
    "cover.single",
    "alarm_control_panel.deevana2_alarm",
    "binary_sensor.garage_door",
    "binary_sensor.front_door",
    "binary_sensor.backyard_door",
]


def _build_state_snapshot() -> str:
    lines = []
    for entity_id in _KEY_ENTITIES:
        try:
            state = _ha.get_state(entity_id)
            lines.append(f"{entity_id}: {state['state']}")
        except Exception:
            lines.append(f"{entity_id}: unknown")
    return "\n".join(lines)


def _parse_claude_actions(text: str) -> list:
    actions = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("{") and stripped.endswith("}"):
            try:
                obj = json.loads(stripped)
                if "action" in obj:
                    actions.append(obj)
            except json.JSONDecodeError:
                pass
    return actions


def _execute_claude_actions(actions: list) -> list:
    taken = []
    for act in actions:
        try:
            if act.get("action") == "service":
                _ha.call_service(act["domain"], act["service"], act["entity_id"])
                taken.append(act)
            elif act.get("action") == "script":
                _ha.run_script(act["id"])
                taken.append(act)
            elif act.get("action") == "schedule":
                delay = float(act.get("delay_seconds", 0))
                script_id = act["script"]
                threading.Timer(delay, lambda sid=script_id: _ha.run_script(sid)).start()
                taken.append(act)
        except Exception as e:
            app.logger.error("Failed to execute Claude action %s: %s", act, e)
    return taken


def _call_claude(user_text: str, snapshot: str) -> tuple[str, list]:
    history_str = "\n".join(
        f"User: {h['user']}\nAssistant: {h['assistant']}" for h in session_history
    )
    people_str = json.dumps(_people, indent=2)

    prompt = f"""You are a Home Assistant AI. Control smart home devices and answer questions.

Current device state:
{snapshot}

People registry:
{people_str}

Recent conversation:
{history_str}

User: {user_text}

Respond in natural language. If a device action is needed, include tool call JSON on its own line:
{{"action": "service", "domain": "lock", "service": "lock", "entity_id": "lock.front_door"}}
{{"action": "script", "id": "script.goodnight"}}
{{"action": "schedule", "script": "script.arrive_home", "delay_seconds": 1200}}

Only include JSON lines for actions to execute. Speak naturally for everything else."""

    try:
        client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        output = response.text.strip()
    except Exception as e:
        return f"AI error: {e}", []

    actions = _parse_claude_actions(output)
    clean_lines = [
        line for line in output.splitlines()
        if not (line.strip().startswith("{") and line.strip().endswith("}") and '"action"' in line)
    ]
    clean = "\n".join(clean_lines).strip()
    executed = _execute_claude_actions(actions)
    return clean or output, executed


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/converse", methods=["POST"])
def converse():
    body = request.get_json(silent=True) or {}
    text = body.get("text", "").strip()
    source = body.get("source", "unknown")

    if not text:
        return jsonify({"error": "text is required"}), 400

    result = engine.classify(text)

    if result.tier == 4:
        snapshot = _build_state_snapshot()
        response_text, actions_taken = _call_claude(text, snapshot)
    else:
        response_text = result.response
        actions_taken = result.actions_taken

    session_history.append({"user": text, "assistant": response_text})

    return jsonify({"response": response_text, "actions_taken": actions_taken})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8124)
