"""
Smoke test: real intent engine wired to real bridge endpoints.
HA REST API is mocked. Claude subprocess is mocked.
"""
import json
import pytest
from unittest.mock import patch, Mock
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


def mock_ha_state(entity_id):
    states = {
        "lock.front_door": "locked",
        "cover.double_car_garage_door": "closed",
        "cover.single_car_garage_door": "closed",
        "alarm_control_panel.ring_alarm": "armed_home",
        "binary_sensor.front_door_contact": "off",
        "person.deepak_aryan": "home",
        "person.bunny": "not_home",
    }
    return {"state": states.get(entity_id, "unknown")}


def mock_ha_states():
    return [
        {"entity_id": eid, "state": state}
        for eid, state in {
            "lock.front_door": "locked",
            "cover.double_car_garage_door": "closed",
            "cover.single_car_garage_door": "closed",
            "alarm_control_panel.ring_alarm": "armed_home",
            "binary_sensor.front_door_contact": "off",
        }.items()
    ]


@pytest.mark.parametrize("text,expected_fragment", [
    ("lock the door", "locked"),
    ("goodnight", "goodnight"),
    ("is the door locked?", "locked"),
    ("who's home?", "deepak"),
    ("is the house secure?", "secure"),
    ("close the garage", "closing"),
])
def test_smoke_tier1_tier2(client, text, expected_fragment):
    with patch("ha_bridge._ha.call_service"), \
         patch("ha_bridge._ha.run_script"), \
         patch("ha_bridge._ha.get_state", side_effect=mock_ha_state), \
         patch("ha_bridge._ha.get_states", side_effect=mock_ha_states):
        resp = client.post("/converse", json={"text": text, "source": "assist"})
    assert resp.status_code == 200
    data = resp.get_json()
    assert expected_fragment in data["response"].lower(), \
        f"'{expected_fragment}' not in '{data['response']}'"


def test_smoke_tier3_departure(client):
    with patch("ha_bridge._ha.call_service"), \
         patch("ha_bridge._ha.run_script") as mock_script, \
         patch("ha_bridge._ha.get_state", side_effect=mock_ha_state), \
         patch("ha_bridge._ha.get_states", side_effect=mock_ha_states):
        resp = client.post("/converse", json={"text": "I'm leaving but Bunny is home", "source": "assist"})
    assert resp.status_code == 200
    mock_script.assert_called_once_with("script.leave_home_resident_staying")


def test_smoke_tier4_calls_claude(client):
    with patch("ha_bridge._ha.get_state", side_effect=mock_ha_state), \
         patch("ha_bridge._ha.get_states", side_effect=mock_ha_states), \
         patch("ha_bridge._call_claude", return_value=("It's sunny tomorrow.", [])):
        resp = client.post("/converse", json={"text": "what's the weather like?", "source": "telegram"})
    assert resp.status_code == 200
    assert "sunny" in resp.get_json()["response"].lower()
