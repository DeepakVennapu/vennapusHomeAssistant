# Tesla Fleet API Integration — Design Spec

**Date:** 2026-05-31  
**Status:** APPROVED  
**Project:** homeassistant  

---

## Overview

Integrate Tesla Fleet API into Home Assistant using the official `tesla_fleet` HA integration. Wire Tesla entities into the existing `ha_bridge.py` + `intent_engine.py` AI assistant so voice/text commands like "lock my car" and "is my Tesla charged?" work through HA Assist. Add automations for charging alerts, leave prep, and security.

---

## Architecture

```
HA Assist (voice/text)
       ↓
ha_claude custom component → ha_bridge.py (Flask :8124)
       ↓                              ↓
intent_engine.py              HA REST API (:8123)
  Tier 1: Tesla commands              ↓
  Tier 2: Tesla status        tesla_fleet integration
                                      ↓
                              Tesla Fleet API (cloud)
                                      ↓
                              Tesla vehicle
```

**No new services.** `tesla_fleet` runs inside the existing HA container. `ha_bridge.py` calls HA REST API as it does today — Tesla entities are just additional entity IDs.

---

## Tesla App Credentials

Already configured in `.env` and `config/`:

- `TESLA_CLIENT_ID` — OAuth 2.0 client ID
- `TESLA_CLIENT_SECRET` — client secret
- `config/tesla_fleet.key` — EC private key for Fleet API command signing
- OAuth redirect: `https://my.home-assistant.io/redirect/oauth` (correct for self-hosted HA)
- Scopes: all Fleet API scopes enabled

---

## Section 1: HA Integration Setup

Install `tesla_fleet` via **Settings → Integrations → Add → Tesla Fleet**.

Configuration:
- **Polling policy:** Normal (polls only when car is awake — avoids background drain)
- **Polling interval:** 660s (default)
- OAuth flow completes via `my.home-assistant.io` middleman — works with Cloudflare tunnel

After OAuth, HA creates entities. Exact IDs include a VIN suffix — confirm actual IDs as first implementation step. Expected entities:

| Entity | Type | Purpose |
|--------|------|---------|
| `sensor.tesla_battery_level` | sensor | Battery % |
| `sensor.tesla_range` | sensor | Estimated range (miles) |
| `lock.tesla_door_lock` | lock | Lock/unlock |
| `climate.tesla_hvac_climate_system` | climate | Pre-heat/cool |
| `binary_sensor.tesla_charging` | binary_sensor | Is charging? |
| `sensor.tesla_charging_rate` | sensor | Charging speed (mi/hr) |
| `sensor.tesla_time_to_full_charge` | sensor | ETA to 100% |
| `binary_sensor.tesla_plugged_in` | binary_sensor | Is plugged in? |
| `device_tracker.tesla_location` | device_tracker | GPS location |

---

## Section 2: Intent Engine Rules

### Tier 1 — Commands (direct HA service calls)

Added to `_TIER1_RULES` in `intent_engine.py`:

| Pattern | Service | Entity |
|---------|---------|--------|
| `lock\s+(my\s+)?car\|lock\s+(the\s+)?tesla` | `lock.lock` | `lock.tesla_door_lock_*` |
| `unlock\s+(my\s+)?car\|unlock\s+(the\s+)?tesla` | `lock.unlock` | `lock.tesla_door_lock_*` |
| `(start\|turn\s+on)\s+(climate\|heat\|ac)\|warm\s+up\s+(the\s+)?car\|cool\s+down\s+(the\s+)?car` | `climate.turn_on` | `climate.tesla_hvac_*` |
| `(stop\|turn\s+off)\s+(climate\|heat\|ac)` | `climate.turn_off` | `climate.tesla_hvac_*` |
| `start\s+charg(e\|ing)\s+(the\s+)?(car\|tesla)` | `switch.turn_on` | `switch.tesla_charger_*` |
| `stop\s+charg(e\|ing)\s+(the\s+)?(car\|tesla)` | `switch.turn_off` | `switch.tesla_charger_*` |

### Tier 2 — Status Queries (natural language responses)

Added to `_TIER2_RULES` in `intent_engine.py`:

| Pattern | Handler |
|---------|---------|
| `(what.?s\|how\s+much\|check)\s+(my\s+)?(battery\|charge)\|how\s+charged` | `tesla_battery` |
| `(what.?s\s+my\s+range\|how\s+far\s+can\s+the\s+tesla)` | `tesla_range` |
| `is\s+(my\s+)?(car\|tesla)\s+(locked\|unlocked)` | `tesla_lock_status` |
| `is\s+(my\s+)?(car\|tesla)\s+charg(ing\|ed)\|is\s+the\s+tesla\s+plug` | `tesla_charging_status` |
| `where\s+is\s+(my\s+)?(car\|tesla)` | `tesla_location` |

### Tier 2 Response Format

```
tesla_battery:    "Your Tesla is at {battery}% — {range} miles of range."
                  (if stale: "Last known: {battery}%, {range} miles (as of {time}).")
tesla_lock_status: "Your Tesla is locked." / "Your Tesla is unlocked."
tesla_charging_status: "Charging at {rate} mi/hr, {eta} to full." /
                       "Not charging. {plugged_in_state}."
tesla_location:   "Your Tesla is at home." / "Your Tesla is at {address}."
```

---

## Section 3: ha_bridge.py Additions

New function `_handle_tesla_status(handler, ha_client)`:
- Reads entity states via `ha_client.get_state(entity_id)`
- Checks `state == "unavailable"` → returns "Tesla status unavailable right now."
- Formats natural language response per handler type above
- Called from existing Tier 2 dispatch in `handle_converse()`

No new Flask routes. Tesla status slots into the existing Tier 2 response pipeline.

---

## Section 4: Scripts

### `script.tesla_leave_prep`
1. Turn on climate (`climate.turn_on`)
2. Check lock state — if unlocked, lock it
3. Respond: "Tesla climate started and car is locked."

### `script.tesla_goodnight`
1. Lock car (`lock.lock`)
2. Respond: "Tesla locked for the night."

Note: No stop-charging logic. Car has LFP battery — charging to 100% is correct and recommended for BMS calibration.

Voice triggers:
- "prepare my car / get my car ready" → `script.tesla_leave_prep`
- "tesla goodnight" → `script.tesla_goodnight`

---

## Section 5: Automations

### `tesla_charging_complete`
- **Trigger:** `sensor.tesla_battery_level` reaches 100
- **Condition:** `binary_sensor.tesla_plugged_in` is on
- **Action:** Notify (mobile app) — "Tesla is fully charged, safe to unplug."
- **Note:** LFP battery — 100% is the correct daily charge target.

### `tesla_leave_prep_auto`
- **Trigger:** `person.deepak` → `not_home`
- **Condition:** `binary_sensor.tesla_plugged_in` is on (car is home and plugged in)
- **Action:** Run `script.tesla_leave_prep` (climate on + lock check)

### `tesla_plugged_in_reminder`
- **Trigger:** `person.deepak` → `home` (arrives home)
- **Delay:** 30 minutes
- **Condition:** `binary_sensor.tesla_plugged_in` is off
- **Action:** Notify — "Your Tesla isn't plugged in."

### `tesla_left_unlocked`
- **Trigger:** `person.deepak` → `not_home`
- **Condition:** `lock.tesla_door_lock_*` is unlocked
- **Action:** Lock car + notify — "Tesla was unlocked — locking it now."

---

## Section 6: Lovelace Dashboard

New "Tesla" tab in `ui-lovelace.yaml`:

```
- Battery gauge card (sensor.tesla_battery_level)
- Glance card: range, charging rate, time to full
- Entity card: plugged in state, charging binary sensor
- Button card: Lock / Unlock
- Climate card: on/off toggle, current temp
- Map card: device_tracker.tesla_location
```

---

## Section 7: Edge Cases

| Scenario | Behavior |
|----------|----------|
| Car asleep | Status: returns last known state, labeled with age. Commands: Fleet API wakes car automatically (~30-60s). Bridge responds: "Waking your Tesla, may take a moment." |
| Car away from home | All commands work (cloud-based). Location returns current GPS. |
| Tesla API unavailable | HA marks entities unavailable. Bridge returns: "Tesla status unavailable right now." |
| Entity IDs with VIN suffix | Discovery step in implementation: set up integration, confirm exact entity IDs before wiring rules. |

---

## Implementation Order

1. Set up `tesla_fleet` HA integration via UI → confirm entity IDs
2. Add Tier 1 + Tier 2 rules to `intent_engine.py`
3. Add `_handle_tesla_status()` to `ha_bridge.py`
4. Add scripts to `scripts.yaml`
5. Add automations to `automations.yaml`
6. Add Tesla tab to `ui-lovelace.yaml`
7. End-to-end test: voice → bridge → Tesla
