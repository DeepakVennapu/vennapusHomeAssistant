# Home Assistant — Deepak's Smart Home

Self-hosted smart home running on an iMac via Docker Compose. Home Assistant handles device control and automations; Cloudflare Tunnel provides secure remote access.

## Remote Access

**URL:** https://hass.deevana.uk

## Architecture

```
You / Partner
  ├── https://hass.deevana.uk  ←  Cloudflare Tunnel  ←  cloudflared (iMac daemon)
  └── http://192.168.x.x:8123  ←  local network
        └── Home Assistant (Docker)
              ├── Mosquitto MQTT broker (Docker)
              └── ring-mqtt (Docker) — bridges Ring devices to HA
```

## Stack

| Container | Purpose |
|-----------|---------|
| `homeassistant` | HA core — automations, dashboard, integrations |
| `mosquitto` | MQTT broker for ring-mqtt |
| `ring-mqtt` | Bridges Ring alarm, cameras, sensors to HA via MQTT |

## Device Integrations

| Device | Integration | Type |
|--------|-------------|------|
| Ring alarm + sensors (7) + cameras (2) + doorbell | ring-mqtt | HACS/Docker |
| Aladdin Connect garage doors (2) | Official | Cloud |
| Kwikset Halo Select lock | kwikset-ha | HACS (explosivo22/kwikset-ha) |
| B-Hyve sprinklers (8 zones) | bhyve | HACS |
| Honeywell FocusPRO S200 thermostat | — | Parked |

## Setup on a new machine

Prereqs: Docker Desktop (macOS/Linux), `cloudflared` installed as a system service, HACS already installed inside HA (automatic once HA is running — see HACS docs for first-run).

```bash
# 1. Clone + fill env
git clone git@github.com:DeepakVennapu/vennapusHomeAssistant.git homeassistant
cd homeassistant
cp .env.example .env
# Edit .env — fill HA_TOKEN (generate at HA → Profile → Long-Lived Access Tokens),
# MQTT_PASSWORD (match mosquitto/config/passwd), GEMINI_API_KEY, Tesla Fleet creds.

# 2. Start the stack
docker compose up -d

# 3. First-time HACS components to install from inside HA → HACS tab:
#    - bhyve (B-Hyve sprinklers)
#    - kwikset-ha (explosivo22/kwikset-ha)
#    tesla_custom, hacs, ha_claude are version-pinned in this repo and auto-load.
```

Confirm HA is up: open http://localhost:8123 (local) or https://hass.deevana.uk (remote via Cloudflare).

## Quick Start

```bash
# Start all services
docker compose up -d

# Stop all services
docker compose down

# Restart HA only
docker compose restart homeassistant

# View HA logs
docker compose logs homeassistant -f
```

## Key Files

```
homeassistant/
├── docker-compose.yml          # All services
├── config/
│   ├── configuration.yaml      # HA core config (http, trusted proxies)
│   ├── automations.yaml        # All automations
│   ├── scripts.yaml
│   └── scenes.yaml
├── mosquitto/
│   └── config/                 # Mosquitto broker config
└── ring-mqtt/                  # ring-mqtt persistent data + auth
```

## Cloudflare Tunnel

The `cloudflared` service is installed as a macOS system service (runs on boot):

```bash
# Check tunnel status
sudo cloudflared service status

# View tunnel logs
sudo cloudflared service log
```

Two routes are configured for `hass.deevana.uk` (order matters — Cloudflare evaluates top-down):

| # | Path | Service | Purpose |
|---|------|---------|---------|
| 1 | `.well-known` | `localhost:8124` | Tesla Fleet API public key endpoint |
| 2 | `*` | `localhost:8123` | Home Assistant UI |

The `configuration.yaml` includes trusted proxy settings required for the tunnel to work:
```yaml
http:
  use_x_forwarded_for: true
  trusted_proxies:
    - 127.0.0.1
    - ::1
    - 192.168.65.1   # Docker Desktop VM gateway (local access)
    - 172.19.0.1     # ha_net bridge gateway (Cloudflare tunnel traffic)
```

**Important:** `172.19.0.1` is the gateway of the `ha_net` Docker bridge network. The subnet is pinned in `docker-compose.yml` to `172.19.0.0/16` so this IP stays stable across restarts. Without the pinned subnet, Docker can reassign a different gateway on restart, breaking the tunnel with a `400 Bad Request`.

## Confirmed Entity IDs

These were verified in HA Developer Tools — use these in automations and scripts, not guessed names.

| Device | Entity ID |
|--------|-----------|
| Double garage door | `cover.double` |
| Single garage door | `cover.single` |
| Front door lock (Kwikset) | `lock.main_door` |
| Ring alarm panel | `alarm_control_panel.deevana2_alarm` |
| Deepak (person) | `person.deepak_aryan` |
| Bunny (person) | `person.bunny` |
| Deepak (device tracker) | `device_tracker.deepak` |
| Bunny (device tracker) | `device_tracker.bunny` |

> Always use `person.*` entities (not `device_tracker.*`) for presence-based automations — person entities aggregate all trackers and are more reliable for zone triggers.

## Zone Notes

- `zone.close_garage` — 200m radius, kept `passive: true`. Passive zones don't show in the Who's Home display and don't compete with the built-in `home` zone. The garage-close automation triggers on `person → not_home` (home zone departure) instead, so this zone is no longer needed for triggers — kept for potential future condition use.
- `zone.near_home` — 250m radius, used to trigger garage open and alarm disarm on arrival.

## What's Next

- [ ] HA companion app on iPhone + Android (use hass.deevana.uk)
- [ ] Build Lovelace dashboard (security bar + 6 tabs)
- [ ] Set up 7 v1 automations
- [ ] Revisit Honeywell TCC thermostat integration
- [ ] GitHub private repo for config backup
