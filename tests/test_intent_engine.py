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

# --- Tesla Tier 1 tests ---

TESLA_LOCK_ID = "lock.hermoine_s_den_lock"
TESLA_CLIMATE_ID = "climate.hermoine_s_den_climate"
TESLA_CHARGER_ID = "switch.hermoine_s_den_charge"

def test_tier1_tesla_lock_car(engine, mock_client):
    result = engine.classify("lock my car")
    assert result.tier == 1
    mock_client.call_service.assert_called_once_with("lock", "lock", TESLA_LOCK_ID)

def test_tier1_tesla_lock_tesla(engine, mock_client):
    result = engine.classify("lock the Tesla")
    assert result.tier == 1
    mock_client.call_service.assert_called_once_with("lock", "lock", TESLA_LOCK_ID)

def test_tier1_tesla_unlock_car(engine, mock_client):
    result = engine.classify("unlock my car")
    assert result.tier == 1
    mock_client.call_service.assert_called_once_with("lock", "unlock", TESLA_LOCK_ID)

def test_tier1_tesla_start_climate(engine, mock_client):
    result = engine.classify("warm up the car")
    assert result.tier == 1
    mock_client.call_service.assert_called_once_with("climate", "turn_on", TESLA_CLIMATE_ID)

def test_tier1_tesla_start_climate_cool(engine, mock_client):
    result = engine.classify("cool down the car")
    assert result.tier == 1
    mock_client.call_service.assert_called_once_with("climate", "turn_on", TESLA_CLIMATE_ID)

def test_tier1_tesla_stop_climate(engine, mock_client):
    result = engine.classify("turn off the climate")
    assert result.tier == 1
    mock_client.call_service.assert_called_once_with("climate", "turn_off", TESLA_CLIMATE_ID)

def test_tier1_tesla_start_charging(engine, mock_client):
    result = engine.classify("start charging the car")
    assert result.tier == 1
    mock_client.call_service.assert_called_once_with("switch", "turn_on", TESLA_CHARGER_ID)

def test_tier1_tesla_stop_charging(engine, mock_client):
    result = engine.classify("stop charging the Tesla")
    assert result.tier == 1
    mock_client.call_service.assert_called_once_with("switch", "turn_off", TESLA_CHARGER_ID)

def test_tier1_tesla_lock_does_not_match_front_door(engine, mock_client):
    """'lock the door' must still hit main_door, not Tesla."""
    result = engine.classify("lock the door")
    assert result.tier == 1
    mock_client.call_service.assert_called_once_with("lock", "lock", "lock.main_door")

def test_tier1_tesla_stop_climate_no_false_positive(engine, mock_client):
    """'turn off the AC' without car/tesla context should NOT trigger Tesla climate."""
    result = engine.classify("turn off the AC")
    # Should NOT call Tesla climate service
    assert result.tier != 1 or not any(
        call[0] == ("climate", "turn_off", "climate.hermoine_s_den_climate")
        for call in mock_client.call_service.call_args_list
    )

# --- Tesla Tier 2 tests ---

TESLA_BATTERY_ENTITY = "sensor.hermoine_s_den_battery_level"
TESLA_RANGE_ENTITY = "sensor.hermoine_s_den_battery_range"
TESLA_LOCK_ENTITY = "lock.hermoine_s_den_lock"
TESLA_CHARGING_ENTITY = "sensor.hermoine_s_den_charging"
TESLA_CHARGE_RATE_ENTITY = "sensor.hermoine_s_den_charge_rate"
TESLA_TIME_TO_FULL_ENTITY = "sensor.hermoine_s_den_time_to_full_charge"
TESLA_CHARGE_CABLE_ENTITY = "binary_sensor.hermoine_s_den_charge_cable"
TESLA_LOCATION_ENTITY = "device_tracker.hermoine_s_den_location"

def test_tier2_tesla_battery_query(engine, mock_client):
    mock_client.get_state.side_effect = lambda eid: {
        TESLA_BATTERY_ENTITY: {"state": "85"},
        TESLA_RANGE_ENTITY: {"state": "247.5"},
    }.get(eid, {"state": "unknown"})
    result = engine.classify("what's my battery")
    assert result.tier == 2
    assert "85%" in result.response
    assert "247" in result.response

def test_tier2_tesla_battery_unavailable(engine, mock_client):
    mock_client.get_state.side_effect = lambda eid: {"state": "unavailable"}
    result = engine.classify("how charged is the Tesla")
    assert result.tier == 2
    assert "unavailable" in result.response.lower()

def test_tier2_tesla_lock_status_locked(engine, mock_client):
    mock_client.get_state.side_effect = lambda eid: (
        {"state": "locked"} if eid == TESLA_LOCK_ENTITY else {"state": "unknown"}
    )
    result = engine.classify("is my car locked")
    assert result.tier == 2
    assert "locked" in result.response.lower()

def test_tier2_tesla_lock_status_unlocked(engine, mock_client):
    mock_client.get_state.side_effect = lambda eid: (
        {"state": "unlocked"} if eid == TESLA_LOCK_ENTITY else {"state": "unknown"}
    )
    result = engine.classify("is the Tesla locked")
    assert result.tier == 2
    assert "unlocked" in result.response.lower()

def test_tier2_tesla_charging_active(engine, mock_client):
    mock_client.get_state.side_effect = lambda eid: {
        TESLA_CHARGING_ENTITY: {"state": "charging"},
        TESLA_CHARGE_RATE_ENTITY: {"state": "32.0"},
        TESLA_TIME_TO_FULL_ENTITY: {"state": "1.5"},
    }.get(eid, {"state": "unknown"})
    result = engine.classify("is my car charging")
    assert result.tier == 2
    assert "32" in result.response

def test_tier2_tesla_charging_disconnected(engine, mock_client):
    mock_client.get_state.side_effect = lambda eid: {
        TESLA_CHARGING_ENTITY: {"state": "disconnected"},
        TESLA_CHARGE_CABLE_ENTITY: {"state": "off"},
    }.get(eid, {"state": "unknown"})
    result = engine.classify("is the Tesla charging")
    assert result.tier == 2
    assert "not charging" in result.response.lower()

def test_tier2_tesla_location_home(engine, mock_client):
    mock_client.get_state.side_effect = lambda eid: (
        {"state": "home"} if eid == TESLA_LOCATION_ENTITY else {"state": "unknown"}
    )
    result = engine.classify("where is my car")
    assert result.tier == 2
    assert "home" in result.response.lower()
