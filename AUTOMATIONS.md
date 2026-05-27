# Automations

All automations are defined in `config/automations.yaml`.

---

## Presence

| ID | Name | Trigger | Action |
|---|---|---|---|
| `leave_for_work_close_garage` | Leave for Work — Close Garages | Deepak leaves home zone | Close both garage doors + notify |
| `last_person_leaves_arm_away` | Last Person Leaves — Arm Away | Deepak leaves home zone | Lock front door + arm away + notify |
| `arriving_home_open_garage` | Arriving Home — Open Garage | Deepak enters Near Home zone (~0.5mi) | Open double garage + notify |
| `arriving_home_disarm_alarm` | Arriving Home — Disarm Alarm | Deepak enters Near Home zone, alarm is armed away | Disarm alarm |

> **Note:** Leave automations don't yet account for Bunny being home. Once she has the HA companion app, add a presence condition before arming away.

---

## Security

| ID | Name | Trigger | Condition | Action |
|---|---|---|---|---|
| `alarm_triggered_notify` | Alarm Triggered — Notify | Alarm state → `triggered` | — | Critical push notification |
| `flood_freeze_alert` | Flood/Freeze Sensor Alert | Any flood/freeze sensor turns on | — | Critical push notification |
| `night_motion_alert` | Night Motion Alert | Any motion sensor turns on | 10pm–6am + alarm armed home | Push with sensor name + time |
| `front_door_unlocked_too_long` | Front Door Unlocked > 10 Minutes | `lock.main_door` unlocked for 10 min | — | Push notification |
| `garage_open_too_long` | Garage Open > 10 Minutes | Either garage open for 10 min | — | Push with garage name |
| `door_window_open_too_long` | Door/Window Open > 10 Minutes | Any contact sensor open for 10 min | — | Push with sensor name |

**Contact sensors watched:** Front Door, Backyard, Back Window, Basement, Living Room, Garage
**Motion sensors watched:** Front Door, Garage, Garden, Entryway Keypad
**Flood/freeze sensors watched:** Basement Flood, Basement Freeze, Kitchen Flood, Kitchen Freeze

---

## Time-Based

| ID | Name | Trigger | Condition | Action |
|---|---|---|---|---|
| `midnight_open_check` | Midnight — Open Door/Garage Check | 12:00am daily | Any garage or door is open | Push listing everything still open |
| `rain_delay_auto` | Auto Rain Delay | `weather.home` forecast changes | Rain probability > 50% + rain delay off | Enable sprinkler rain delay + notify |

> **Note:** `rain_delay_auto` requires a weather integration (`weather.home`). No-op if not configured.

---

## Zones

Defined in `config/zones.yaml`.

| Zone | Center | Radius | Used by |
|---|---|---|---|
| `zone.near_home` | 40.5273, -112.0379 | 800m (~0.5 mi) | Arriving home automations |

---

## Pending / Deferred

- **Thermostat (Honeywell FocusPRO S200)** — HomeKit Controller integration needed first. Find pairing code on thermostat, add HomeKit Controller in HA, then wire `climate.*` entity into automations.
- **Feit Electric lights** — Tuya integration needed first. Then add light-based automations (motion-triggered lights, departure lights off, etc.).
- **Bunny presence** — Once she installs the HA companion app, update `last_person_leaves_arm_away` to condition on both people being away before arming.
