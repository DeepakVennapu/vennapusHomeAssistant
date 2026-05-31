import datetime
import logging
import re
import threading
from dataclasses import dataclass, field
from typing import Optional

import dateparser

_LOGGER = logging.getLogger(__name__)


@dataclass
class IntentResult:
    tier: int
    response: str
    actions_taken: list = field(default_factory=list)


# (pattern, action_type, payload)
# action_type: "service" | "script"
# payload for service: (domain, service, entity_id)
# payload for script: script_id
_TIER1_RULES = [
    # Tesla — commands (BEFORE generic lock so "lock my car" doesn't hit main_door)
    (r"\b(lock|secure)\b.*(my\s+)?(car|tesla)\b", "service", ("lock", "lock", "lock.hermoine_s_den_lock")),
    (r"\bunlock\b.*(my\s+)?(car|tesla)\b", "service", ("lock", "unlock", "lock.hermoine_s_den_lock")),
    (r"\b(start|turn\s+on)\b.*(climate|heat|ac)\b|\bwarm\s+up\b.*(the\s+)?(car|tesla)\b|\bcool\s+down\b.*(the\s+)?(car|tesla)\b", "service", ("climate", "turn_on", "climate.hermoine_s_den_climate")),
    (r"\b(stop|turn\s+off)\b.*(climate)\b|\b(stop|turn\s+off)\b.*\b(car|tesla)\b.*\b(heat|ac)\b|\b(stop|turn\s+off)\b.*(heat|ac)\b.*(car|tesla)\b", "service", ("climate", "turn_off", "climate.hermoine_s_den_climate")),
    (r"\bstart\s+charg(e|ing)\b.*(the\s+)?(car|tesla)\b", "service", ("switch", "turn_on", "switch.hermoine_s_den_charge")),
    (r"\bstop\s+charg(e|ing)\b.*(the\s+)?(car|tesla)\b", "service", ("switch", "turn_off", "switch.hermoine_s_den_charge")),

    # Lock / unlock
    (r"\b(lock\s*up|secure\s+the\s+house)\b", "script", "script.lock_up"),
    (r"\b(lock|secure)\b.*(door|front)", "service", ("lock", "lock", "lock.main_door")),
    (r"\bunlock\b.*(door|front)", "service", ("lock", "unlock", "lock.main_door")),

    # Garages — specific
    (r"\bclose\b.*\bdouble\b.*\bgarage\b", "service", ("cover", "close_cover", "cover.double")),
    (r"\bclose\b.*\bsingle\b.*\bgarage\b", "service", ("cover", "close_cover", "cover.single")),
    (r"\bopen\b.*\bdouble\b.*\bgarage\b", "service", ("cover", "open_cover", "cover.double")),
    (r"\bopen\b.*\bsingle\b.*\bgarage\b", "service", ("cover", "open_cover", "cover.single")),

    # Garages — generic (close both)
    (r"\bclose\b.*(garage|garages)\b", "script", "script.close_all_garages"),
    (r"\bopen\b.*(garage)\b", "service", ("cover", "open_cover", "cover.double")),

    # Alarm
    (r"\barm\b.*(alarm|home)\b(?!.*away)", "service", ("alarm_control_panel", "alarm_arm_home", "alarm_control_panel.deevana2_alarm")),
    (r"\barm\b.*\baway\b", "service", ("alarm_control_panel", "alarm_arm_away", "alarm_control_panel.deevana2_alarm")),
    (r"\bdisarm\b.*(alarm)?", "service", ("alarm_control_panel", "alarm_disarm", "alarm_control_panel.deevana2_alarm")),

    # Sprinkler rain delay
    (r"\brain\s*delay\b", "service", ("input_boolean", "turn_on", "input_boolean.rain_delay")),

    # Routines / scripts
    (r"\bgoodnight\b", "script", "script.goodnight"),
    (r"\bgood\s*morning\b", "script", "script.good_morning"),
    (r"\b(i.?m\s+leaving|i\s+am\s+leaving|leaving\s+home|leaving\s+now)\b", "script", "script.leave_home"),
    (r"\b(arrive|arriving|i.?m\s+home|i\s+am\s+home)\b(?!.*in\s+\d)", "script", "script.arrive_home"),

    # Tesla scripts
    (r"\b(prepare|get)\b.*(my\s+)?(car|tesla)\b.*\bready\b|\bprepare\s+my\s+car\b", "script", "script.tesla_leave_prep"),
    (r"\btesla\s+goodnight\b", "script", "script.tesla_goodnight"),
]

_TIER2_RULES = [
    (r"\bis\s+the\s+door\s+(locked|unlocked|open|closed)\??", "lock_status"),
    (r"\bis\s+the\s+(front\s+)?door\b", "lock_status"),
    (r"\bis\s+the\s+(double\s+|single\s+)?garage\b", "garage_status"),
    (r"\bis\s+the\s+(house|home)\s+secure\??", "house_secure"),
    (r"\b(who.?s\s+home|who\s+is\s+home|anyone\s+home)\??", "whos_home"),
    (r"\b(alarm\s+status|is\s+the\s+alarm)\b", "alarm_status"),

    # Tesla status queries
    (r"\b(what.?s|how\s+much|check)\s+(my\s+)?(battery|charge)\b|\bhow\s+charged\b", "tesla_battery"),
    (r"\bwhat.?s\s+my\s+range\b|\bhow\s+far\s+can\s+(the\s+)?tesla\b", "tesla_range"),
    (r"\bis\s+(my\s+|the\s+)?(car|tesla)\s+(locked|unlocked)\??", "tesla_lock_status"),
    (r"\bis\s+(my\s+|the\s+)?(car|tesla)\s+charg(ing|ed)\??|\bis\s+the\s+tesla\s+plug", "tesla_charging_status"),
    (r"\bwhere\s+is\s+(my\s+|the\s+)?(car|tesla)\b", "tesla_location"),
]

_TIER3_TIME_RULES = [
    (r"\bclose\b.*(double\s+)?garage\b.*(in\s+\d|at\s+)", ("cover", "close_cover", "cover.double")),
    (r"\bclose\b.*(single\s+)?garage\b.*(in\s+\d|at\s+)", ("cover", "close_cover", "cover.single")),
    (r"\barm\b.*(alarm)?.*(in\s+\d|at\s+)", ("alarm_control_panel", "alarm_arm_home", "alarm_control_panel.deevana2_alarm")),
    (r"\bclose\b.*(garage|garages)\b.*(in\s+\d|at\s+)", "script.close_all_garages"),
]

_TIER3_DEPARTURE_PATTERN = r"\b(i.?m\s+leaving|leaving)\b.+\b(home|staying)\b"
_TIER3_ARRIVAL_PATTERN = r"\b(i.?ll\s+be\s+home|arriving)\s+in\s+(\d+)\s*(min|hour)"

# Pre-check patterns — inputs matching these are routed to Tier 3 before Tier 1
_TIER3_PRECHECK_PATTERN = (
    r"\b(in\s+\d+\s*(min|hour)|at\s+\d)"  # time modifiers
    r"|" + _TIER3_DEPARTURE_PATTERN         # departure with resident staying
)


class IntentEngine:
    def __init__(self, client, people: dict):
        self._client = client
        self._people = people["people"]

    def classify(self, text: str) -> IntentResult:
        lower = text.lower()

        # Check Tier 3 first for time-modified inputs and departure-with-resident
        # (prevents Tier 1 from swallowing them)
        if re.search(_TIER3_PRECHECK_PATTERN, lower, re.IGNORECASE):
            result = self._try_tier3(lower)
            if result and result.tier == 3:
                return result

        result = self._try_tier1(lower)
        if result:
            return result

        result = self._try_tier2(lower)
        if result:
            return result

        result = self._try_tier3(lower)
        if result and result.tier == 3:
            return result

        return IntentResult(tier=4, response="")

    # --- Tier 1 ---

    def _try_tier1(self, text: str) -> Optional[IntentResult]:
        for pattern, action_type, payload in _TIER1_RULES:
            if re.search(pattern, text, re.IGNORECASE):
                return self._execute_tier1(action_type, payload)
        return None

    def _execute_tier1(self, action_type: str, payload) -> IntentResult:
        if action_type == "service":
            domain, service, entity_id = payload
            self._client.call_service(domain, service, entity_id)
            return IntentResult(
                tier=1,
                response=self._service_response(domain, service, entity_id),
                actions_taken=[{"action": "service", "domain": domain, "service": service, "entity_id": entity_id}],
            )
        else:  # script
            self._client.run_script(payload)
            return IntentResult(
                tier=1,
                response=self._script_response(payload),
                actions_taken=[{"action": "script", "id": payload}],
            )

    def _service_response(self, domain: str, service: str, entity_id: str) -> str:
        label = entity_id.replace("_", " ").split(".")[-1].capitalize()
        action_map = {
            ("lock", "lock"): f"{label} locked.",
            ("lock", "unlock"): f"{label} unlocked.",
            ("cover", "close_cover"): f"{label} closing.",
            ("cover", "open_cover"): f"{label} opening.",
            ("alarm_control_panel", "alarm_arm_home"): "Alarm armed (home).",
            ("alarm_control_panel", "alarm_arm_away"): "Alarm armed (away).",
            ("alarm_control_panel", "alarm_disarm"): "Alarm disarmed.",
            ("input_boolean", "turn_on"): "Rain delay enabled.",
            ("climate", "turn_on"): "Tesla climate started — car will be ready shortly.",
            ("climate", "turn_off"): "Tesla climate off.",
            ("switch", "turn_on"): "Tesla charging started.",
            ("switch", "turn_off"): "Tesla charging stopped.",
        }
        return action_map.get((domain, service), "Done.")

    def _script_response(self, script_id: str) -> str:
        return {
            "script.goodnight": "Goodnight! Locking up and arming the alarm.",
            "script.good_morning": "Good morning! Alarm disarmed.",
            "script.leave_home": "Locking up and arming away mode.",
            "script.leave_home_resident_staying": "Locking up and arming home mode.",
            "script.arrive_home": "Welcome home! Opening the garage.",
            "script.close_all_garages": "Closing both garages.",
            "script.lock_up": "Locking up and arming home mode.",
            "script.tesla_leave_prep": "Tesla climate started and car is locked.",
            "script.tesla_goodnight": "Tesla locked for the night.",
        }.get(script_id, "Done.")

    # --- Tier 2 ---

    def _try_tier2(self, text: str) -> Optional[IntentResult]:
        for pattern, query_type in _TIER2_RULES:
            if re.search(pattern, text, re.IGNORECASE):
                return self._execute_tier2(query_type)
        return None

    def _execute_tier2(self, query_type: str) -> IntentResult:
        if query_type == "lock_status":
            state = self._client.get_state("lock.main_door")["state"]
            return IntentResult(tier=2, response=f"The main door is {state}.")

        elif query_type == "garage_status":
            double = self._client.get_state("cover.double")["state"]
            single = self._client.get_state("cover.single")["state"]
            return IntentResult(tier=2, response=f"Double garage is {double}, single garage is {single}.")

        elif query_type == "alarm_status":
            state = self._client.get_state("alarm_control_panel.deevana2_alarm")["state"]
            return IntentResult(tier=2, response=f"Alarm is {state.replace('_', ' ')}.")

        elif query_type == "house_secure":
            return self._house_secure_check()

        elif query_type == "whos_home":
            return self._whos_home()

        elif query_type == "tesla_battery":
            battery = self._client.get_state("sensor.hermoine_s_den_battery_level")
            range_ = self._client.get_state("sensor.hermoine_s_den_battery_range")
            if battery["state"] == "unavailable":
                return IntentResult(tier=2, response="Tesla status unavailable right now.")
            return IntentResult(
                tier=2,
                response=f"Your Tesla is at {battery['state']}% — {int(float(range_['state']))} miles of range.",
            )

        elif query_type == "tesla_range":
            range_ = self._client.get_state("sensor.hermoine_s_den_battery_range")
            if range_["state"] == "unavailable":
                return IntentResult(tier=2, response="Tesla status unavailable right now.")
            return IntentResult(tier=2, response=f"Your Tesla has {int(float(range_['state']))} miles of range.")

        elif query_type == "tesla_lock_status":
            state = self._client.get_state("lock.hermoine_s_den_lock")
            if state["state"] == "unavailable":
                return IntentResult(tier=2, response="Tesla status unavailable right now.")
            return IntentResult(tier=2, response=f"Your Tesla is {state['state']}.")

        elif query_type == "tesla_charging_status":
            charging = self._client.get_state("sensor.hermoine_s_den_charging")
            if charging["state"] == "unavailable":
                return IntentResult(tier=2, response="Tesla status unavailable right now.")
            if charging["state"] == "charging":
                rate = self._client.get_state("sensor.hermoine_s_den_charge_rate")
                eta = self._client.get_state("sensor.hermoine_s_den_time_to_full_charge")
                eta_str = f", {eta['state']} hours to full" if eta["state"] not in ("unavailable", "unknown") else ""
                return IntentResult(
                    tier=2,
                    response=f"Charging at {rate['state']} mi/hr{eta_str}.",
                )
            else:
                cable = self._client.get_state("binary_sensor.hermoine_s_den_charge_cable")
                plugged_str = "plugged in" if cable["state"] == "on" else "not plugged in"
                return IntentResult(tier=2, response=f"Not charging. Car is {plugged_str}.")

        elif query_type == "tesla_location":
            loc = self._client.get_state("device_tracker.hermoine_s_den_location")
            if loc["state"] == "unavailable":
                return IntentResult(tier=2, response="Tesla location unavailable right now.")
            location_str = "at home" if loc["state"] == "home" else f"at {loc['state']}"
            return IntentResult(tier=2, response=f"Your Tesla is {location_str}.")

        return IntentResult(tier=4, response="")

    def _house_secure_check(self) -> IntentResult:
        states = {s["entity_id"]: s["state"] for s in self._client.get_states()}
        issues = []
        if states.get("lock.main_door") != "locked":
            issues.append("main door is unlocked")
        if states.get("cover.double") != "closed":
            issues.append("double garage is open")
        if states.get("cover.single") != "closed":
            issues.append("single garage is open")
        alarm = states.get("alarm_control_panel.deevana2_alarm", "unknown")
        if alarm not in ("armed_home", "armed_away"):
            issues.append(f"alarm is {alarm.replace('_', ' ')}")

        if not issues:
            return IntentResult(tier=2, response="The house looks secure. Door locked, garages closed, alarm armed.")
        return IntentResult(tier=2, response=f"Not fully secure: {'; '.join(issues)}.")

    def _whos_home(self) -> IntentResult:
        home = []
        for person in self._people:
            try:
                state = self._client.get_state(person["ha_entity"])["state"]
                if state == "home":
                    home.append(person["names"][0])
            except Exception as e:
                _LOGGER.warning("Could not get state for %s: %s", person["ha_entity"], e)
        if not home:
            return IntentResult(tier=2, response="Nobody is home right now.")
        return IntentResult(tier=2, response=f"{', '.join(home)} {'is' if len(home) == 1 else 'are'} home.")

    # --- Tier 3 ---

    def _try_tier3(self, text: str) -> Optional[IntentResult]:
        # Departure modifier: "I'm leaving but [name] is home"
        if re.search(_TIER3_DEPARTURE_PATTERN, text, re.IGNORECASE):
            return self._handle_departure_with_resident(text)

        # Arrival with delay: "I'll be home in 20 mins"
        m = re.search(_TIER3_ARRIVAL_PATTERN, text, re.IGNORECASE)
        if m:
            value = int(m.group(2))
            unit = m.group(3).lower()
            delay = value * 60 if unit.startswith("min") else value * 3600
            return self._schedule_script(
                "script.arrive_home", delay,
                f"I'll open the garage in {value} {unit}(s).",
            )

        # Time-modified service calls
        for pattern, payload in _TIER3_TIME_RULES:
            if re.search(pattern, text, re.IGNORECASE):
                delay = self._extract_delay_seconds(text)
                if delay is None:
                    continue
                mins = int(delay // 60)
                if isinstance(payload, str) and payload.startswith("script."):
                    script_id = payload
                    threading.Timer(
                        delay,
                        lambda sid=script_id: self._client.run_script(sid),
                    ).start()
                    return IntentResult(
                        tier=3,
                        response=f"Scheduled for {mins} minute(s) from now.",
                        actions_taken=[{
                            "action": "schedule",
                            "script": script_id,
                            "delay_seconds": delay,
                        }],
                    )
                else:
                    domain, service, entity_id = payload
                    threading.Timer(
                        delay,
                        lambda d=domain, s=service, e=entity_id: self._client.call_service(d, s, e),
                    ).start()
                    return IntentResult(
                        tier=3,
                        response=f"Scheduled for {mins} minute(s) from now.",
                        actions_taken=[{
                            "action": "scheduled_service",
                            "domain": domain,
                            "service": service,
                            "entity_id": entity_id,
                            "delay_seconds": delay,
                        }],
                    )

        return None

    def _extract_delay_seconds(self, text: str) -> Optional[float]:
        """Extract a delay in seconds from text like 'in 10 minutes' or 'at 10pm'."""
        # "in N minutes/hours"
        m = re.search(r"\bin\s+(\d+)\s*(min|hour)", text, re.IGNORECASE)
        if m:
            value = int(m.group(1))
            unit = m.group(2).lower()
            return value * 60 if unit.startswith("min") else value * 3600

        # "at H[am/pm]" or "at H:MM[am/pm]"
        m = re.search(r"\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", text, re.IGNORECASE)
        if m:
            hour = int(m.group(1))
            minute = int(m.group(2)) if m.group(2) else 0
            meridiem = (m.group(3) or "").lower()
            if meridiem == "pm" and hour != 12:
                hour += 12
            elif meridiem == "am" and hour == 12:
                hour = 0
            now = datetime.datetime.now()
            target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if target <= now:
                target += datetime.timedelta(days=1)
            return (target - now).total_seconds()

        # Fallback: try dateparser
        parsed = dateparser.parse(text, settings={"PREFER_DATES_FROM": "future"})
        if parsed:
            return max(0, (parsed - datetime.datetime.now()).total_seconds())

        return None

    def _handle_departure_with_resident(self, text: str) -> IntentResult:
        lower = text.lower()
        for person in self._people:
            if person["role"] == "resident":
                for name in person["names"]:
                    if name.lower() in lower:
                        self._client.run_script("script.leave_home_resident_staying")
                        return IntentResult(
                            tier=3,
                            response=f"Leaving with {person['names'][0]} staying home. Arming home mode.",
                            actions_taken=[{"action": "script", "id": "script.leave_home_resident_staying"}],
                        )
        return IntentResult(tier=4, response="")

    def _schedule_script(self, script_id: str, delay_seconds: float, response_text: str) -> IntentResult:
        threading.Timer(delay_seconds, lambda: self._client.run_script(script_id)).start()
        return IntentResult(
            tier=3,
            response=response_text,
            actions_taken=[{"action": "schedule", "script": script_id, "delay_seconds": delay_seconds}],
        )
