# Automations

All automations are defined in `config/automations.yaml`. Scripts in `config/scripts.yaml`.

---

## Garage Scenarios

| Scenario | Trigger | What Happens |
|----------|---------|--------------|
| Deepak leaves | `person.deepak_aryan` → `not_home` | Both garages close, both notified |
| Bunny leaves | `person.bunny` → `not_home` | Both garages close, both notified |
| Deepak arrives | `person.deepak_aryan` → `home` | Double garage opens, Deepak notified |
| Bunny arrives | `person.bunny` → `home` | Double garage opens, Bunny notified |
| Either garage open 5+ min | State timer | Auto-closes, both notified |
| Either garage open 10+ min | State timer | Both notified, repeats every 10 min until closed |
| Midnight check | 00:00 daily | Both notified if either garage still open |
| Single garage | — | Never opens automatically — manual only |

> Leave fires for **either** person leaving regardless of whether the other is home.
> Arrive/leave boundary is determined by `zone.home` radius (currently **100m**).

---

## Presence Automations

| ID | Trigger | Condition | Action |
|----|---------|-----------|--------|
| `leave_for_work_close_garage` | Either person → `not_home` | — | Close both garages + notify both |
| `last_person_leaves_arm_away` | Either person → `not_home` | Both are `not_home` | Lock front door + arm away + notify both |
| `arriving_home_open_garage_deepak` | `person.deepak_aryan` → `home` | — | Open double garage + notify Deepak |
| `arriving_home_open_garage_bunny` | `person.bunny` → `home` | — | Open double garage + notify Bunny |
| `arriving_home_disarm_alarm` | Either person → `home` | Alarm is `armed_away` | Disarm alarm |

---

## Security Automations

| ID | Trigger | Condition | Action |
|----|---------|-----------|--------|
| `alarm_triggered_notify` | `alarm_control_panel.deevana2_alarm` → `triggered` | — | Critical push to both |
| `flood_freeze_alert` | Any flood/freeze sensor → `on` | — | Critical push to both |
| `night_motion_alert` | Any motion sensor → `on` | 10pm–6am + alarm `armed_home` | Push with sensor name + time |
| `front_door_unlocked_too_long` | `lock.main_door` unlocked for 10 min | — | Push to both |
| `garage_auto_close_5min` | Either garage open for 5 min | — | Auto-close + push to both |
| `garage_open_too_long` | Either garage open for 10 min | — | Push to both, repeats every 10 min |
| `door_window_open_too_long` | Any contact sensor open for 10 min | — | Push to both |

**Contact sensors:** Front Door, Backyard, Back Window, Basement, Living Room, Garage
**Motion sensors:** Front Door, Garage, Garden, Entryway Keypad
**Flood/freeze sensors:** Basement, Kitchen

---

## Time-Based Automations

| ID | Trigger | Condition | Action |
|----|---------|-----------|--------|
| `midnight_open_check` | 00:00 daily | Any garage or door open | Push listing everything still open |
| `rain_delay_auto` | `weather.home` forecast changes | Rain probability > 50% + rain delay off | Enable sprinkler rain delay + notify Deepak |

---

## Scripts (Manual / Dashboard)

| Script | What It Does |
|--------|-------------|
| `goodnight` | Lock front door + close both garages + arm home |
| `good_morning` | Disarm alarm + unlock front door |
| `leave_home` | Close both garages + lock front door + arm away |
| `leave_home_resident_staying` | Close both garages + lock front door + arm home |
| `arrive_home` | Disarm alarm + open double garage |
| `close_all_garages` | Close both garages |
| `lock_up` | Lock front door + arm home |

---

## Zones

Defined in `config/zones.yaml`. Both custom zones are `passive: true` — they don't appear in the Who's Home display and don't compete with `zone.home`.

| Zone | Radius | Passive | Purpose |
|------|--------|---------|---------|
| `zone.home` | 100m | No | Primary presence zone — all arrive/leave triggers use this |
| `zone.near_home` | 250m | Yes | Reserved for future early-trigger use |
| `zone.close_garage` | 200m | Yes | Reserved for future use |

---

## Confirmed Entity IDs

See `README.md` for the full entity reference table.

| Device | Entity ID |
|--------|-----------|
| Double garage | `cover.double` |
| Single (gym) garage | `cover.single` |
| Front door lock | `lock.main_door` |
| Ring alarm | `alarm_control_panel.deevana2_alarm` |
| Deepak (person) | `person.deepak_aryan` |
| Bunny (person) | `person.bunny` |

---

## Pending / Deferred

- **Thermostat (Honeywell FocusPRO S200)** — HomeKit Controller integration needed. Find pairing code on thermostat display, add HomeKit Controller in HA, wire `climate.*` into intent engine.
- **Feit Electric lights** — Tuya integration needed. Create Tuya developer account, link Feit app, add Tuya integration in HA.
