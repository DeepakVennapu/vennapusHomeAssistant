# Tesla Fleet API Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Tesla Fleet API into Home Assistant so voice/text commands via HA Assist control the Tesla (lock, climate, charging) and return status (battery, range, location).

**Architecture:** Use the official `tesla_fleet` HA integration (UI setup, OAuth via my.home-assistant.io) to create native HA entities. Wire those entities into the existing `intent_engine.py` (Tier 1 commands + Tier 2 status) and `ha_bridge.py` (`_handle_tesla_status()`). Add scripts and automations for leave prep, goodnight, charging alerts, and security.

**Tech Stack:** Home Assistant `tesla_fleet` integration, Python (intent_engine.py, ha_bridge.py), HA YAML (scripts.yaml, automations.yaml, ui-lovelace.yaml), pytest

---

## File Map

| File | Change |
|------|--------|
| `intent_engine.py` | Add 6 Tier 1 Tesla rules + 5 Tier 2 Tesla rules + `_execute_tesla_tier2()` method |
| `ha_bridge.py` | Add `_handle_tesla_status()` + wire into `converse()` + add Tesla entities to `_KEY_ENTITIES` |
| `config/scripts.yaml` | Add `tesla_leave_prep` + `tesla_goodnight` scripts |
| `config/automations.yaml` | Add 4 Tesla automations |
| `config/ui-lovelace.yaml` | Add Tesla tab |
| `tests/test_intent_engine.py` | Add Tesla Tier 1 + Tier 2 tests |
| `tests/test_bridge.py` | Add `_handle_tesla_status()` tests |

**Note on entity IDs:** Tesla Fleet integration appends a VIN-based suffix to all entity IDs (e.g., `lock.tesla_door_lock_5yj3e1ea1pf000316`). Task 1 is the discovery step — you must complete it before Tasks 2-7 to get the real entity IDs. All code in Tasks 2-7 uses placeholder `TESLA_*` constants defined in Task 2 that you fill in from Task 1 results.

---

## Task 1: Set up tesla_fleet HA integration + discover entity IDs

**Files:** None (UI-only setup)

- [ ] **Step 1: Open HA and add integration**

  In a browser, go to `http://localhost:8123` (or `https://hass.deevana.uk`).
  Navigate to **Settings → Integrations → + Add Integration → search "Tesla Fleet"**.

- [ ] **Step 2: Complete OAuth**

  Click through the OAuth flow. You'll be redirected to `my.home-assistant.io`, which redirects to Tesla's auth page. Log in with your Tesla account. Authorize the app ("Home Assistant for Vennapus").

  After redirect, HA will complete setup. You should see "Tesla Fleet" in your integrations list.

- [ ] **Step 3: Set polling policy to Normal**

  In the Tesla Fleet integration card, click **Configure**. Set:
  - Polling policy: **Normal**
  - Wake on start: **off**

- [ ] **Step 4: Discover actual entity IDs**

  Go to **Settings → Devices & Services → Tesla Fleet → your vehicle**.
  Or go to **Developer Tools → States**, filter by "tesla".

  Record the exact entity IDs. You need:
  - battery level sensor (e.g. `sensor.my_model_3_battery_level`)
  - range sensor (e.g. `sensor.my_model_3_range`)
  - door lock (e.g. `lock.my_model_3_door_lock`)
  - HVAC climate (e.g. `climate.my_model_3_hvac_climate_system`)
  - charging binary sensor (e.g. `binary_sensor.my_model_3_charging`)
  - charging rate sensor (e.g. `sensor.my_model_3_charging_rate`)
  - time to full charge sensor (e.g. `sensor.my_model_3_time_to_full_charge`)
  - plugged in binary sensor (e.g. `binary_sensor.my_model_3_plugged_in`)
  - location device tracker (e.g. `device_tracker.my_model_3_location`)

  Write all of them down — you'll use them in every subsequent task.

- [ ] **Step 5: Verify entities have real data**

  In Developer Tools → States, click your battery sensor. Confirm it shows a real % value (not "unavailable"). If unavailable, wake the car via the Tesla app, wait 60s, then refresh.

- [ ] **Step 6: Commit**

  ```bash
  git add config/
  git commit -m "feat: set up tesla_fleet HA integration via UI"
  ```

---

## Task 2: Define Tesla entity ID constants + add to bridge state snapshot

**Files:**
- Modify: `ha_bridge.py` (lines 30-38 `_KEY_ENTITIES`, line 14 imports area)

**Prerequisite:** Complete Task 1 and have real entity IDs.

- [ ] **Step 1: Write the failing test**

  In `tests/test_bridge.py`, add at the top of the file after existing imports:

  ```python
  # Tesla entity IDs used across bridge tests
  TESLA_BATTERY = "sensor.my_model_3_battery_level"      # replace with real ID from Task 1
  TESLA_RANGE = "sensor.my_model_3_range"
  TESLA_LOCK = "lock.my_model_3_door_lock"
  TESLA_CLIMATE = "climate.my_model_3_hvac_climate_system"
  TESLA_CHARGING = "binary_sensor.my_model_3_charging"
  TESLA_CHARGING_RATE = "sensor.my_model_3_charging_rate"
  TESLA_TIME_TO_FULL = "sensor.my_model_3_time_to_full_charge"
  TESLA_PLUGGED_IN = "binary_sensor.my_model_3_plugged_in"
  TESLA_LOCATION = "device_tracker.my_model_3_location"
  ```

  Then add a test that Tesla entities appear in the state snapshot:

  ```python
  def test_state_snapshot_includes_tesla_entities(client):
      """Tesla entities are included in the HA state snapshot sent to Gemini."""
      with patch("ha_bridge._ha") as mock_ha:
          mock_ha.get_state.return_value = {"state": "85"}
          response = client.get("/health")
          # snapshot is built inside converse, so we verify via a converse call
          mock_ha.get_state.side_effect = lambda eid: {"state": "85"} if "tesla" in eid else {"state": "locked"}
          resp = client.post("/converse", json={"text": "hello"})
          # entity lookup was attempted for tesla battery
          calls = [str(c) for c in mock_ha.get_state.call_args_list]
          assert any(TESLA_BATTERY in c for c in calls)
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  cd /Users/me/deep-workspace/homeassistant
  pytest tests/test_bridge.py::test_state_snapshot_includes_tesla_entities -v
  ```

  Expected: FAIL — Tesla entity not in `_KEY_ENTITIES`.

- [ ] **Step 3: Add Tesla entity constants and extend _KEY_ENTITIES in ha_bridge.py**

  At the top of `ha_bridge.py`, after line 14 (`from intent_engine import IntentEngine`), add:

  ```python
  # Tesla Fleet entity IDs — update with actual IDs from HA after integration setup
  TESLA_BATTERY = "sensor.my_model_3_battery_level"      # replace with real ID
  TESLA_RANGE = "sensor.my_model_3_range"
  TESLA_LOCK = "lock.my_model_3_door_lock"
  TESLA_CLIMATE = "climate.my_model_3_hvac_climate_system"
  TESLA_CHARGING = "binary_sensor.my_model_3_charging"
  TESLA_CHARGING_RATE = "sensor.my_model_3_charging_rate"
  TESLA_TIME_TO_FULL = "sensor.my_model_3_time_to_full_charge"
  TESLA_PLUGGED_IN = "binary_sensor.my_model_3_plugged_in"
  TESLA_LOCATION = "device_tracker.my_model_3_location"
  ```

  Then extend `_KEY_ENTITIES` (currently lines 30-38) to:

  ```python
  _KEY_ENTITIES = [
      "lock.main_door",
      "cover.double",
      "cover.single",
      "alarm_control_panel.deevana2_alarm",
      "binary_sensor.garage_door",
      "binary_sensor.front_door",
      "binary_sensor.backyard_door",
      TESLA_BATTERY,
      TESLA_RANGE,
      TESLA_LOCK,
      TESLA_PLUGGED_IN,
      TESLA_CHARGING,
  ]
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  pytest tests/test_bridge.py::test_state_snapshot_includes_tesla_entities -v
  ```

  Expected: PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

  ```bash
  pytest tests/ -v
  ```

  Expected: all previously passing tests still pass.

- [ ] **Step 6: Commit**

  ```bash
  git add ha_bridge.py tests/test_bridge.py
  git commit -m "feat: add Tesla entity constants and include in state snapshot"
  ```

---

## Task 3: Add Tesla Tier 1 intent rules (commands)

**Files:**
- Modify: `intent_engine.py` (lines 24-53 `_TIER1_RULES`, lines 135-158 response methods)
- Modify: `tests/test_intent_engine.py`

**Prerequisite:** Task 2 complete (entity ID constants defined).

- [ ] **Step 1: Write the failing tests**

  In `tests/test_intent_engine.py`, add after existing Tier 1 tests:

  ```python
  # --- Tesla Tier 1 tests ---

  TESLA_LOCK_ID = "lock.my_model_3_door_lock"          # replace with real ID from Task 1
  TESLA_CLIMATE_ID = "climate.my_model_3_hvac_climate_system"
  TESLA_CHARGER_ID = "switch.my_model_3_charger"       # confirm this entity exists in Task 1

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
      """'lock the door' should still hit main_door, not Tesla."""
      result = engine.classify("lock the door")
      assert result.tier == 1
      mock_client.call_service.assert_called_once_with("lock", "lock", "lock.main_door")
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  pytest tests/test_intent_engine.py -k "tesla" -v
  ```

  Expected: all Tesla tests FAIL with "AssertionError" (wrong tier or wrong entity).

- [ ] **Step 3: Add Tesla Tier 1 rules to intent_engine.py**

  In `intent_engine.py`, replace the `_TIER1_RULES` list (lines 24-53) with the version below. Tesla rules are added at the end, **before** the generic lock rule so "lock my car" doesn't match `lock.main_door`:

  ```python
  _TIER1_RULES = [
      # Lock / unlock house
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

      # Tesla — commands (must come BEFORE generic lock/unlock to avoid main_door match)
      (r"\b(lock|secure)\b.*(my\s+)?(car|tesla)\b", "service", ("lock", "lock", "lock.my_model_3_door_lock")),
      (r"\bunlock\b.*(my\s+)?(car|tesla)\b", "service", ("lock", "unlock", "lock.my_model_3_door_lock")),
      (r"\b(start|turn\s+on)\b.*(climate|heat|ac)\b|\bwarm\s+up\b.*(the\s+)?(car|tesla)\b|\bcool\s+down\b.*(the\s+)?(car|tesla)\b", "service", ("climate", "turn_on", "climate.my_model_3_hvac_climate_system")),
      (r"\b(stop|turn\s+off)\b.*(climate|heat|ac)\b", "service", ("climate", "turn_off", "climate.my_model_3_hvac_climate_system")),
      (r"\bstart\s+charg(e|ing)\b.*(the\s+)?(car|tesla)\b", "service", ("switch", "turn_on", "switch.my_model_3_charger")),
      (r"\bstop\s+charg(e|ing)\b.*(the\s+)?(car|tesla)\b", "service", ("switch", "turn_off", "switch.my_model_3_charger")),

      # Tesla — scripts
      (r"\b(prepare|get)\b.*(my\s+)?(car|tesla)\b.*\bready\b|\bprepare\s+my\s+car\b", "script", "script.tesla_leave_prep"),
      (r"\btesla\s+goodnight\b", "script", "script.tesla_goodnight"),
  ]
  ```

  **Important:** Replace `lock.my_model_3_door_lock`, `climate.my_model_3_hvac_climate_system`, and `switch.my_model_3_charger` with the real entity IDs you found in Task 1.

  Then add Tesla responses to `_service_response()` (currently lines 135-147). Replace the `action_map` dict:

  ```python
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
  ```

  Add Tesla script responses to `_script_response()` (currently lines 149-158). Add these entries to the dict:

  ```python
  "script.tesla_leave_prep": "Tesla climate started and car is locked.",
  "script.tesla_goodnight": "Tesla locked for the night.",
  ```

- [ ] **Step 4: Run Tesla tests to verify they pass**

  ```bash
  pytest tests/test_intent_engine.py -k "tesla" -v
  ```

  Expected: all Tesla tests PASS.

- [ ] **Step 5: Run full suite to check for regressions**

  ```bash
  pytest tests/ -v
  ```

  Expected: all tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add intent_engine.py tests/test_intent_engine.py
  git commit -m "feat: add Tesla Tier 1 command rules to intent engine"
  ```

---

## Task 4: Add Tesla Tier 2 status rules + _handle_tesla_status() in ha_bridge.py

**Files:**
- Modify: `intent_engine.py` (lines 55-62 `_TIER2_RULES`, lines 168-188 `_execute_tier2()`)
- Modify: `ha_bridge.py` (after `_build_state_snapshot()`, before `/health` route)
- Modify: `tests/test_intent_engine.py`
- Modify: `tests/test_bridge.py`

- [ ] **Step 1: Write failing tests for Tier 2 intent classification**

  In `tests/test_intent_engine.py`, add:

  ```python
  # --- Tesla Tier 2 tests ---

  def test_tier2_tesla_battery_query(engine, mock_client):
      mock_client.get_state.side_effect = lambda eid: {
          "sensor.my_model_3_battery_level": {"state": "85"},
          "sensor.my_model_3_range": {"state": "247"},
      }.get(eid, {"state": "unknown"})
      result = engine.classify("what's my battery")
      assert result.tier == 2
      assert "85%" in result.response
      assert "247" in result.response

  def test_tier2_tesla_battery_query_unavailable(engine, mock_client):
      mock_client.get_state.side_effect = lambda eid: {"state": "unavailable"}
      result = engine.classify("how charged is the Tesla")
      assert result.tier == 2
      assert "unavailable" in result.response.lower()

  def test_tier2_tesla_lock_status_locked(engine, mock_client):
      mock_client.get_state.side_effect = lambda eid: (
          {"state": "locked"} if "door_lock" in eid else {"state": "unknown"}
      )
      result = engine.classify("is my car locked")
      assert result.tier == 2
      assert "locked" in result.response.lower()

  def test_tier2_tesla_lock_status_unlocked(engine, mock_client):
      mock_client.get_state.side_effect = lambda eid: (
          {"state": "unlocked"} if "door_lock" in eid else {"state": "unknown"}
      )
      result = engine.classify("is the Tesla locked")
      assert result.tier == 2
      assert "unlocked" in result.response.lower()

  def test_tier2_tesla_charging_status_charging(engine, mock_client):
      mock_client.get_state.side_effect = lambda eid: {
          "binary_sensor.my_model_3_charging": {"state": "on"},
          "sensor.my_model_3_charging_rate": {"state": "32"},
          "sensor.my_model_3_time_to_full_charge": {"state": "1.5"},
      }.get(eid, {"state": "unknown"})
      result = engine.classify("is my car charging")
      assert result.tier == 2
      assert "32" in result.response

  def test_tier2_tesla_charging_status_not_charging(engine, mock_client):
      mock_client.get_state.side_effect = lambda eid: {
          "binary_sensor.my_model_3_charging": {"state": "off"},
          "binary_sensor.my_model_3_plugged_in": {"state": "on"},
      }.get(eid, {"state": "unknown"})
      result = engine.classify("is the Tesla charging")
      assert result.tier == 2
      assert "not charging" in result.response.lower()

  def test_tier2_tesla_location_home(engine, mock_client):
      mock_client.get_state.side_effect = lambda eid: (
          {"state": "home"} if "location" in eid else {"state": "unknown"}
      )
      result = engine.classify("where is my car")
      assert result.tier == 2
      assert "home" in result.response.lower()
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  pytest tests/test_intent_engine.py -k "tier2_tesla" -v
  ```

  Expected: FAIL — no Tesla Tier 2 rules exist yet.

- [ ] **Step 3: Add Tesla Tier 2 rules to intent_engine.py**

  In `intent_engine.py`, extend `_TIER2_RULES` (currently lines 55-62):

  ```python
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
      (r"\bis\s+(my\s+)?(car|tesla)\s+(locked|unlocked)\??", "tesla_lock_status"),
      (r"\bis\s+(my\s+)?(car|tesla)\s+charg(ing|ed)\??|\bis\s+the\s+tesla\s+plug", "tesla_charging_status"),
      (r"\bwhere\s+is\s+(my\s+)?(car|tesla)\b", "tesla_location"),
  ]
  ```

  Then extend `_execute_tier2()` in `intent_engine.py` (currently lines 168-188). Add Tesla handlers before the final `return IntentResult(tier=4, response="")`:

  ```python
  elif query_type == "tesla_battery":
      battery = self._client.get_state("sensor.my_model_3_battery_level")  # replace with real ID
      range_ = self._client.get_state("sensor.my_model_3_range")           # replace with real ID
      if battery["state"] == "unavailable":
          return IntentResult(tier=2, response="Tesla status unavailable right now.")
      return IntentResult(
          tier=2,
          response=f"Your Tesla is at {battery['state']}% — {range_['state']} miles of range.",
      )

  elif query_type == "tesla_range":
      range_ = self._client.get_state("sensor.my_model_3_range")           # replace with real ID
      if range_["state"] == "unavailable":
          return IntentResult(tier=2, response="Tesla status unavailable right now.")
      return IntentResult(tier=2, response=f"Your Tesla has {range_['state']} miles of range.")

  elif query_type == "tesla_lock_status":
      state = self._client.get_state("lock.my_model_3_door_lock")          # replace with real ID
      if state["state"] == "unavailable":
          return IntentResult(tier=2, response="Tesla status unavailable right now.")
      return IntentResult(tier=2, response=f"Your Tesla is {state['state']}.")

  elif query_type == "tesla_charging_status":
      charging = self._client.get_state("binary_sensor.my_model_3_charging")    # replace with real ID
      if charging["state"] == "unavailable":
          return IntentResult(tier=2, response="Tesla status unavailable right now.")
      if charging["state"] == "on":
          rate = self._client.get_state("sensor.my_model_3_charging_rate")      # replace with real ID
          eta = self._client.get_state("sensor.my_model_3_time_to_full_charge") # replace with real ID
          return IntentResult(
              tier=2,
              response=f"Charging at {rate['state']} mi/hr, {eta['state']} hours to full.",
          )
      else:
          plugged = self._client.get_state("binary_sensor.my_model_3_plugged_in")  # replace with real ID
          plugged_str = "plugged in" if plugged["state"] == "on" else "not plugged in"
          return IntentResult(tier=2, response=f"Not charging. Car is {plugged_str}.")

  elif query_type == "tesla_location":
      loc = self._client.get_state("device_tracker.my_model_3_location")   # replace with real ID
      if loc["state"] == "unavailable":
          return IntentResult(tier=2, response="Tesla location unavailable right now.")
      location_str = "at home" if loc["state"] == "home" else f"at {loc['state']}"
      return IntentResult(tier=2, response=f"Your Tesla is {location_str}.")
  ```

- [ ] **Step 4: Run Tesla Tier 2 tests to verify they pass**

  ```bash
  pytest tests/test_intent_engine.py -k "tier2_tesla" -v
  ```

  Expected: all PASS.

- [ ] **Step 5: Run full suite**

  ```bash
  pytest tests/ -v
  ```

  Expected: all pass.

- [ ] **Step 6: Commit**

  ```bash
  git add intent_engine.py tests/test_intent_engine.py
  git commit -m "feat: add Tesla Tier 2 status rules to intent engine"
  ```

---

## Task 5: Add Tesla scripts to scripts.yaml

**Files:**
- Modify: `config/scripts.yaml`

- [ ] **Step 1: Append Tesla scripts to config/scripts.yaml**

  Open `config/scripts.yaml` and append at the end:

  ```yaml
  tesla_leave_prep:
    alias: Tesla Leave Prep
    sequence:
      - action: climate.turn_on
        target:
          entity_id: climate.my_model_3_hvac_climate_system   # replace with real ID
      - action: lock.lock
        target:
          entity_id: lock.my_model_3_door_lock                # replace with real ID
    mode: single

  tesla_goodnight:
    alias: Tesla Goodnight
    sequence:
      - action: lock.lock
        target:
          entity_id: lock.my_model_3_door_lock                # replace with real ID
    mode: single
  ```

- [ ] **Step 2: Reload scripts in HA**

  In HA, go to **Developer Tools → YAML → Reload Scripts**. Or run:

  ```bash
  curl -X POST http://localhost:8123/api/services/script/reload \
    -H "Authorization: Bearer $HA_TOKEN"
  ```

- [ ] **Step 3: Verify scripts appear in HA**

  In HA, go to **Settings → Automations & Scenes → Scripts**. Confirm "Tesla Leave Prep" and "Tesla Goodnight" appear in the list.

- [ ] **Step 4: Commit**

  ```bash
  git add config/scripts.yaml
  git commit -m "feat: add tesla_leave_prep and tesla_goodnight scripts"
  ```

---

## Task 6: Add Tesla automations to automations.yaml

**Files:**
- Modify: `config/automations.yaml`

- [ ] **Step 1: Append Tesla automations to config/automations.yaml**

  Open `config/automations.yaml` and append at the end:

  ```yaml
  - id: tesla_charging_complete
    alias: "Tesla — Charging Complete"
    description: "Notify when Tesla reaches 100% charge (LFP battery — 100% is correct target)"
    trigger:
      - platform: numeric_state
        entity_id: sensor.my_model_3_battery_level    # replace with real ID
        above: 99
    condition:
      - condition: state
        entity: binary_sensor.my_model_3_plugged_in   # replace with real ID
        state: "on"
    action:
      - action: notify.mobile_app_deepak
        data:
          title: "Tesla Fully Charged"
          message: "Your Tesla is at 100% — safe to unplug."
    mode: single

  - id: tesla_leave_prep_auto
    alias: "Tesla — Leave Prep (Auto)"
    description: "Start Tesla climate when Deepak leaves home"
    trigger:
      - platform: state
        entity_id: person.deepak_aryan
        from: "home"
        to: "not_home"
    condition:
      - condition: state
        entity: binary_sensor.my_model_3_plugged_in   # replace with real ID
        state: "on"
    action:
      - action: script.turn_on
        target:
          entity_id: script.tesla_leave_prep
    mode: single

  - id: tesla_plugged_in_reminder
    alias: "Tesla — Plugged In Reminder"
    description: "Remind Deepak to plug in Tesla if not plugged in 30 min after arriving home"
    trigger:
      - platform: state
        entity_id: person.deepak_aryan
        to: "home"
    condition: []
    action:
      - delay: "00:30:00"
      - condition: state
        entity: binary_sensor.my_model_3_plugged_in   # replace with real ID
        state: "off"
      - action: notify.mobile_app_deepak
        data:
          title: "Tesla Not Plugged In"
          message: "Your Tesla isn't plugged in — don't forget!"
    mode: single

  - id: tesla_left_unlocked
    alias: "Tesla — Left Unlocked on Departure"
    description: "Lock Tesla and notify if it's unlocked when Deepak leaves home"
    trigger:
      - platform: state
        entity_id: person.deepak_aryan
        from: "home"
        to: "not_home"
    condition:
      - condition: state
        entity: lock.my_model_3_door_lock             # replace with real ID
        state: "unlocked"
    action:
      - action: lock.lock
        target:
          entity_id: lock.my_model_3_door_lock        # replace with real ID
      - action: notify.mobile_app_deepak
        data:
          title: "Tesla Locked"
          message: "Your Tesla was unlocked — locking it now."
    mode: single
  ```

- [ ] **Step 2: Reload automations in HA**

  In HA, go to **Developer Tools → YAML → Reload Automations**. Or:

  ```bash
  curl -X POST http://localhost:8123/api/services/automation/reload \
    -H "Authorization: Bearer $HA_TOKEN"
  ```

- [ ] **Step 3: Verify automations appear in HA**

  Go to **Settings → Automations**. Confirm all 4 Tesla automations appear with green status.

- [ ] **Step 4: Commit**

  ```bash
  git add config/automations.yaml
  git commit -m "feat: add Tesla automations (charging, leave prep, plug reminder, unlock alert)"
  ```

---

## Task 7: Add Tesla tab to Lovelace dashboard

**Files:**
- Modify: `config/ui-lovelace.yaml`

- [ ] **Step 1: Read the current end of ui-lovelace.yaml to find the last view**

  Open `config/ui-lovelace.yaml` and scroll to the end to see where to append the Tesla view.

- [ ] **Step 2: Append Tesla view to ui-lovelace.yaml**

  At the end of the `views:` list in `config/ui-lovelace.yaml`, append:

  ```yaml
    # ─── TESLA ─────────────────────────────────────────────────────────────────
    - title: Tesla
      path: tesla
      icon: mdi:car-electric
      cards:

        - type: gauge
          entity: sensor.my_model_3_battery_level     # replace with real ID
          name: Battery
          min: 0
          max: 100
          severity:
            green: 50
            yellow: 20
            red: 0

        - type: glance
          title: Range & Charging
          entities:
            - entity: sensor.my_model_3_range          # replace with real ID
              name: Range (mi)
            - entity: sensor.my_model_3_charging_rate  # replace with real ID
              name: Charge Rate
            - entity: sensor.my_model_3_time_to_full_charge  # replace with real ID
              name: Time to Full

        - type: entities
          title: Status
          entities:
            - entity: binary_sensor.my_model_3_plugged_in   # replace with real ID
              name: Plugged In
            - entity: binary_sensor.my_model_3_charging     # replace with real ID
              name: Charging

        - type: horizontal-stack
          cards:
            - type: button
              entity: lock.my_model_3_door_lock        # replace with real ID
              name: Lock
              icon: mdi:car-key
              tap_action:
                action: call-service
                service: lock.lock
                target:
                  entity_id: lock.my_model_3_door_lock # replace with real ID
            - type: button
              entity: lock.my_model_3_door_lock        # replace with real ID
              name: Unlock
              icon: mdi:car-key-outline
              tap_action:
                action: call-service
                service: lock.unlock
                target:
                  entity_id: lock.my_model_3_door_lock # replace with real ID

        - type: thermostat
          entity: climate.my_model_3_hvac_climate_system  # replace with real ID
          name: Climate

        - type: map
          entities:
            - entity: device_tracker.my_model_3_location  # replace with real ID
          title: Location
          hours_to_show: 1
  ```

- [ ] **Step 3: Reload Lovelace in HA**

  In HA, go to **Settings → Dashboard → (three dots) → Reload Resources**. Or hard-refresh the HA browser tab (Cmd+Shift+R).

- [ ] **Step 4: Verify Tesla tab appears**

  Open the HA dashboard. Confirm a "Tesla" tab appears with the car icon. Verify the battery gauge, range/charging glance card, lock buttons, climate card, and map card all load without errors.

- [ ] **Step 5: Commit**

  ```bash
  git add config/ui-lovelace.yaml
  git commit -m "feat: add Tesla tab to Lovelace dashboard"
  ```

---

## Task 8: End-to-end test

**Files:** None (manual testing)

- [ ] **Step 1: Start/restart ha_bridge**

  ```bash
  cd /Users/me/deep-workspace/homeassistant
  docker compose restart ha_bridge
  docker compose logs ha_bridge --tail=20
  ```

  Expected: "Running on http://0.0.0.0:8124"

- [ ] **Step 2: Test Tier 1 command via curl**

  ```bash
  curl -s -X POST http://localhost:8124/converse \
    -H "Content-Type: application/json" \
    -d '{"text": "lock my car"}' | python3 -m json.tool
  ```

  Expected response: `{"response": "My model 3 door lock locked.", "actions_taken": [...]}`

- [ ] **Step 3: Test Tier 2 status via curl**

  ```bash
  curl -s -X POST http://localhost:8124/converse \
    -H "Content-Type: application/json" \
    -d '{"text": "what is my battery"}' | python3 -m json.tool
  ```

  Expected response: `{"response": "Your Tesla is at 85% — 247 miles of range.", ...}`

- [ ] **Step 4: Test via HA Assist**

  Open HA → click microphone/chat icon (Assist). Type: "Is my car charging?"
  Expected: natural language response routed through ha_claude → ha_bridge → intent_engine.

- [ ] **Step 5: Verify automation triggers (optional live test)**

  Unplug the car (or simulate via Developer Tools → States, set `binary_sensor.my_model_3_plugged_in` to "off").
  Trigger `tesla_plugged_in_reminder` manually via Developer Tools → Actions → `automation.trigger`.
  Confirm push notification arrives on your phone.

- [ ] **Step 6: Final commit and push**

  ```bash
  git log --oneline -8
  git push
  ```

---

## Quick Reference: Replace These Placeholders

After Task 1 discovery, do a global find-replace across all files:

| Placeholder | Replace with |
|-------------|-------------|
| `sensor.my_model_3_battery_level` | actual battery sensor entity ID |
| `sensor.my_model_3_range` | actual range sensor entity ID |
| `lock.my_model_3_door_lock` | actual lock entity ID |
| `climate.my_model_3_hvac_climate_system` | actual climate entity ID |
| `binary_sensor.my_model_3_charging` | actual charging binary sensor entity ID |
| `sensor.my_model_3_charging_rate` | actual charging rate sensor entity ID |
| `sensor.my_model_3_time_to_full_charge` | actual time-to-full sensor entity ID |
| `binary_sensor.my_model_3_plugged_in` | actual plugged-in binary sensor entity ID |
| `device_tracker.my_model_3_location` | actual device tracker entity ID |
| `switch.my_model_3_charger` | actual charger switch entity ID (confirm in Task 1) |
