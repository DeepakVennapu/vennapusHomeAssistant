import pytest
import json
from unittest.mock import patch, Mock, MagicMock
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

os.environ.setdefault("HA_TOKEN", "test_token")
os.environ.setdefault("HA_BASE_URL", "http://localhost:8123")

from ha_bridge import app, session_history

@pytest.fixture(autouse=True)
def clear_history():
    session_history.clear()

@pytest.fixture
def client():
    app.config["TESTING"] = True
    return app.test_client()

def make_mock_engine(tier=1, response="Done.", actions=None):
    from intent_engine import IntentResult
    mock_engine = Mock()
    mock_engine.classify.return_value = IntentResult(
        tier=tier, response=response, actions_taken=actions or []
    )
    return mock_engine

def test_converse_tier1_returns_response(client):
    with patch("ha_bridge.engine") as mock_eng:
        from intent_engine import IntentResult
        mock_eng.classify.return_value = IntentResult(tier=1, response="Front door locked.")
        resp = client.post("/converse", json={"text": "lock the door", "source": "assist"})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["response"] == "Front door locked."

def test_converse_missing_text_returns_400(client):
    resp = client.post("/converse", json={"source": "assist"})
    assert resp.status_code == 400

def test_converse_session_history_accumulates(client):
    with patch("ha_bridge.engine") as mock_eng:
        from intent_engine import IntentResult
        mock_eng.classify.return_value = IntentResult(tier=1, response="Done.")
        client.post("/converse", json={"text": "lock the door", "source": "assist"})
        client.post("/converse", json={"text": "good morning", "source": "assist"})
    assert len(session_history) == 2

def test_converse_session_history_capped_at_5(client):
    with patch("ha_bridge.engine") as mock_eng:
        from intent_engine import IntentResult
        mock_eng.classify.return_value = IntentResult(tier=1, response="Done.")
        for i in range(7):
            client.post("/converse", json={"text": f"command {i}", "source": "assist"})
    assert len(session_history) == 5

def test_converse_tier4_calls_claude(client):
    with patch("ha_bridge.engine") as mock_eng, \
         patch("ha_bridge._call_claude") as mock_claude, \
         patch("ha_bridge._build_state_snapshot") as mock_snap:
        from intent_engine import IntentResult
        mock_eng.classify.return_value = IntentResult(tier=4, response="")
        mock_snap.return_value = "lock: locked"
        mock_claude.return_value = ("Sunny tomorrow.", [])
        resp = client.post("/converse", json={"text": "what's the weather?", "source": "telegram"})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["response"] == "Sunny tomorrow."

def test_health_endpoint(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "ok"
