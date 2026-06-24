# Loveskin NovaStar Agent

Node.js process that runs **on the Raspberry**, alongside Chrome kiosk.
It bridges the cloud Display Manager to the local NovaStar TB50 LED wall
controller so the admin site can turn the LED wall on/off, change brightness,
and schedule auto on/off — all over the LAN, without exposing the TB50 to the
internet.

## How it fits together

```
  Admin UI (Vercel)  ─►  Supabase (display_commands)  ─►  Agent on RPi  ─►  TB50 (TCP)  ─►  LED panels
                                          ▲
                                          │ heartbeat + has_signal
                                          ▼
                                       Admin UI
```

The agent has TWO jobs:
1. Listen on `display_commands` (Realtime + 60s poll), translate each command
   via `applyCommand()`, then mark it `done` / `error`.
2. Every 60s push agent heartbeat + HDMI signal status + run the schedule.

## Prerequisites on the Raspberry

- Node.js 20+
- Network access to the TB50 (e.g. RPi `192.168.1.1`, TB50 `192.168.1.40`)
- Internet (to reach Supabase)

## Install

```bash
# 1) Copy the agent under /opt
sudo mkdir -p /opt/loveskin-agent
sudo chown $USER /opt/loveskin-agent
cp -r raspberry-agent/* /opt/loveskin-agent/
cd /opt/loveskin-agent

# 2) Install deps
npm install

# 3) Configure env
cp .env.example .env
nano .env       # fill DISPLAY_ID, SUPABASE_SERVICE_KEY, TB50_IP

# 4) Test communication with the TB50 BEFORE enabling the service.
#    The test script prints OK/ERR per method so you can confirm what works.
node test.mjs

# 5) Once test.mjs is happy, install the systemd unit
sudo cp novastar-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable novastar-agent
sudo systemctl start novastar-agent
```

## Operating

```bash
# Live logs
journalctl -u novastar-agent -f

# Restart after a config change
sudo systemctl restart novastar-agent

# Stop
sudo systemctl stop novastar-agent
```

## What to verify after first start

1. In Supabase, `displays.agent_last_seen` should refresh every minute
2. The Admin UI should show **Agent online** with green dot
3. Toggling power from the UI should: (a) insert a row in `display_commands`
   (status `pending`), (b) within ~1s the agent should set it to `done`,
   (c) the LED wall should react accordingly (or — if `applyCommand` still
   needs tuning — show an error message you can iterate on)

## Power-off behaviour — open question

Today `power_off` sets brightness to 0: the LED panels go dark but **stay
powered** (fans still on). If you need a real cut of mains power, a NovaStar
Multifunction Card driving a relay is required. When that hardware is added,
extend `applyCommand()` with a `power_relay_off` branch — the rest of the
system already supports new command names through the `display_commands.command`
column.

## Files

- `agent.mjs` — long-running service (this is what systemd starts)
- `test.mjs` — one-shot diagnostic script: confirms which TB50 API methods
  actually respond. Run before finalizing `applyCommand()`
- `package.json` — Node deps (`@novastar/net`, `@novastar/native`,
  `@novastar/screen`, `@supabase/supabase-js`, `dotenv`)
- `novastar-agent.service` — systemd unit (copy to `/etc/systemd/system/`)
- `.env.example` — template for the env file
