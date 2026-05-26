import pytest
from unittest.mock import Mock, patch, MagicMock
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from intent_engine import IntentEngine, IntentResult

@pytest.fixture
def mock_client():
    client = Mock()
    client.get_state.return_value = {"state": "locked"}
    client.get_states.return_value = [
        {"entity_id": "lock.front_door", "state": "locked"},
        {"entity_id": "cover.double_car_garage_door", "state": "closed"},
        {"entity_id": "cover.single_car_garage_door", "state": "closed"},
        {"entity_id": "alarm_control_panel.ring_alarm", "state": "armed_home"},
    ]
    return client

@pytest.fixture
def engine(mock_client):
    people = {
        "people": [
            {"names": ["Deepak", "I", "me"], "ha_entity": "person.deepak_aryan", "role": "owner"},
            {"names": ["Bunny", "my partner", "she"], "ha_entity": "person.bunny", "role": "resident"},
        ]
    }
    return IntentEngine(client=mock_client, people=people)

# --- Tier 1 tests ---

def test_tier1_lock_front_door(engine, mock_client):
    result = engine.classify("lock the door")
    assert result.tier == 1
    assert result.response == "Front door locked."
    mock_client.call_service.assert_called_once_with("lock", "lock", "lock.front_door")

def test_tier1_close_garage(engine, mock_client):
    result = engine.classify("close the garage")
    assert result.tier == 1
    assert "garage" in result.response.lower()

def test_tier1_close_double_garage(engine, mock_client):
    result = engine.classify("close the double garage")
    assert result.tier == 1
    mock_client.call_service.assert_called_once_with("cover", "close_cover", "cover.double_car_garage_door")

def test_tier1_close_single_garage(engine, mock_client):
    result = engine.classify("close the single garage")
    assert result.tier == 1
    mock_client.call_service.assert_called_once_with("cover", "close_cover", "cover.single_car_garage_door")

def test_tier1_open_double_garage(engine, mock_client):
    result = engine.classify("open the double garage")
    assert result.tier == 1
    mock_client.call_service.assert_called_once_with("cover", "open_cover", "cover.double_car_garage_door")

def test_tier1_arm_alarm(engine, mock_client):
    result = engine.classify("arm the alarm")
    assert result.tier == 1

def test_tier1_disarm_alarm(engine, mock_client):
    result = engine.classify("disarm the alarm")
    assert result.tier == 1
    mock_client.call_service.assert_called_once_with(
        "alarm_control_panel", "alarm_disarm", "alarm_control_panel.ring_alarm"
    )

def test_tier1_goodnight(engine, mock_client):
    result = engine.classify("goodnight")
    assert result.tier == 1
    mock_client.run_script.assert_called_once_with("script.goodnight")

def test_tier1_good_morning(engine, mock_client):
    result = engine.classify("good morning")
    assert result.tier == 1
    mock_client.run_script.assert_called_once_with("script.good_morning")

def test_tier1_leaving(engine, mock_client):
    result = engine.classify("I'm leaving")
    assert result.tier == 1
    mock_client.run_script.assert_called_once_with("script.leave_home")

def test_tier1_rain_delay(engine, mock_client):
    result = engine.classify("turn on rain delay")
    assert result.tier == 1

# --- Tier 2 tests ---

def test_tier2_is_door_locked(engine, mock_client):
    mock_client.get_state.return_value = {"state": "locked"}
    result = engine.classify("is the door locked?")
    assert result.tier == 2
    assert "locked" in result.response.lower()

def test_tier2_is_garage_open(engine, mock_client):
    mock_client.get_state.return_value = {"state": "closed"}
    result = engine.classify("is the garage open?")
    assert result.tier == 2
    assert "closed" in result.response.lower()

def test_tier2_whos_home(engine, mock_client):
    mock_client.get_state.side_effect = lambda eid: (
        {"state": "home"} if eid == "person.deepak_aryan" else {"state": "not_home"}
    )
    result = engine.classify("who's home?")
    assert result.tier == 2
    assert "deepak" in result.response.lower()

def test_tier2_house_secure(engine, mock_client):
    result = engine.classify("is the house secure?")
    assert result.tier == 2
    assert any(word in result.response.lower() for word in ["locked", "closed", "armed", "secure"])

def test_tier1_arm_away(engine, mock_client):
    result = engine.classify("arm away")
    assert result.tier == 1
    mock_client.call_service.assert_called_once_with(
        "alarm_control_panel", "alarm_arm_away", "alarm_control_panel.ring_alarm"
    )

def test_tier2_house_not_secure(engine, mock_client):
    mock_client.get_states.return_value = [
        {"entity_id": "lock.front_door", "state": "unlocked"},
        {"entity_id": "cover.double_car_garage_door", "state": "open"},
        {"entity_id": "cover.single_car_garage_door", "state": "closed"},
        {"entity_id": "alarm_control_panel.ring_alarm", "state": "disarmed"},
    ]
    result = engine.classify("is the house secure?")
    assert result.tier == 2
    assert "not fully secure" in result.response.lower()
    assert "front door" in result.response.lower()

def test_tier2_nobody_home(engine, mock_client):
    mock_client.get_state.side_effect = lambda eid: {"state": "not_home"}
    result = engine.classify("who's home?")
    assert result.tier == 2
    assert "nobody" in result.response.lower()

# --- No match → Tier 4 ---

def test_unrecognized_returns_tier4(engine):
    result = engine.classify("what's the weather like tomorrow?")
    assert result.tier == 4

# --- Tier 3 tests ---

def test_tier3_close_garage_in_10_mins(engine):
    result = engine.classify("close the garage in 10 minutes")
    assert result.tier == 3
    assert "10 min" in result.response.lower() or "schedul" in result.response.lower()

def test_tier3_arm_alarm_at_10pm(engine):
    result = engine.classify("arm the alarm at 10pm")
    assert result.tier == 3
    assert "schedul" in result.response.lower() or "10" in result.response

def test_tier3_leaving_but_bunny_home(engine, mock_client):
    result = engine.classify("I'm leaving but Bunny is home")
    assert result.tier == 3
    mock_client.run_script.assert_called_once_with("script.leave_home_resident_staying")

def test_tier3_leaving_but_partner_home(engine, mock_client):
    result = engine.classify("I'm leaving but my partner is home")
    assert result.tier == 3
    mock_client.run_script.assert_called_once_with("script.leave_home_resident_staying")

def test_tier3_ill_be_home_in_20_mins(engine):
    result = engine.classify("I'll be home in 20 minutes")
    assert result.tier == 3
    assert "20 min" in result.response.lower() or "schedul" in result.response.lower()

def test_tier3_close_both_garages_in_5_mins(engine, mock_client):
    with patch("intent_engine.threading.Timer") as mock_timer:
        mock_timer.return_value.start.return_value = None
        result = engine.classify("close both garages in 5 minutes")
    assert result.tier == 3
    assert "schedul" in result.response.lower() or "5 min" in result.response.lower()
    mock_timer.assert_called_once()
