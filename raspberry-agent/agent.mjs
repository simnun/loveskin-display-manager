#!/usr/bin/env node
/**
 * Loveskin NovaStar Agent
 *
 * Long-running process on the Raspberry, alongside Chrome kiosk.
 * - Listens to display_commands (Supabase Realtime + 60s poll fallback)
 * - Translates each command into a TB50 API call via applyCommand()
 * - Sends heartbeat + HDMI signal status to Supabase every 60s
 * - Runs the on/off scheduler
 *
 * Env (see .env.example):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, DISPLAY_ID, TB50_IP
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

// ---- config / env ----
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const DISPLAY_ID = process.env.DISPLAY_ID
const TB50_IP = process.env.TB50_IP || null

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !DISPLAY_ID) {
  console.error('Missing env: SUPABASE_URL / SUPABASE_SERVICE_KEY / DISPLAY_ID are required')
  process.exit(1)
}

// ---- logging ----
const ts = () => new Date().toISOString()
const log  = (...a) => console.log(ts(), '[agent]', ...a)
const warn = (...a) => console.warn(ts(), '[warn] ', ...a)
const err  = (...a) => console.error(ts(), '[err]  ', ...a)

// ---- Supabase ----
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})

// ---- TB50 session ----
let net = null
let native = null
let session = null

async function loadLibs() {
  if (net && native) return
  try {
    net = (await import('@novastar/net')).default ?? (await import('@novastar/net'))
    native = await import('@novastar/native')
    log('Libraries loaded: @novastar/net, @novastar/native')
  } catch (e) {
    err('Cannot load NovaStar libraries:', e?.message ?? e)
    throw e
  }
}

async function ensureSession() {
  if (session) return session
  await loadLibs()
  try {
    session = TB50_IP ? await net.open(TB50_IP) : await net.open()
    log(`Opened TB50 session (${TB50_IP ?? 'auto'})`)
    return session
  } catch (e) {
    err('Failed to open TB50 session:', e?.message ?? e)
    session = null
    throw e
  }
}

function dropSession(reason) {
  if (session) {
    warn(`Dropping TB50 session: ${reason}`)
    try { session.close?.() } catch { /* ignore */ }
  }
  session = null
}

// ----------------------------------------------------------------------------
// applyCommand() — ISOLATED translation layer.
// This is the single place that knows how to talk to the TB50.
// Finalize after test.mjs confirms which methods actually work on this unit.
// UI uses 0..100 brightness, NovaStar library uses 0..255 → convert here.
// ----------------------------------------------------------------------------
async function applyCommand(command, payload) {
  await ensureSession()

  const pct = (v) => Math.max(0, Math.min(100, Number(v) || 0))
  const toRaw = (pct) => Math.round(pct * 2.55)

  switch (command) {
    case 'power_off':
      // Software off: drive brightness to 0 (panels stay powered, display goes black).
      // Hardware off via Multifunction Card relay = future work.
      await native.SetGlobalBrightness(session, 0, 0)
      return { applied: 'brightness=0' }

    case 'power_on': {
      const target = pct(payload?.brightness ?? 80)
      await native.SetGlobalBrightness(session, 0, toRaw(target))
      return { applied: `brightness=${target}%` }
    }

    case 'set_brightness': {
      const target = pct(payload?.brightness ?? 80)
      await native.SetGlobalBrightness(session, 0, toRaw(target))
      return { applied: `brightness=${target}%` }
    }

    case 'freeze':
    case 'normal':
      // Not implemented yet on TB50 — needs research, currently a no-op.
      warn(`Command "${command}" not yet implemented; treating as no-op`)
      return { applied: 'noop' }

    default:
      throw new Error(`Unknown command: ${command}`)
  }
}

// ---- command queue ----
let processing = false

async function processPending() {
  if (processing) return
  processing = true
  try {
    const { data: pending, error: e } = await supabase
      .from('display_commands')
      .select('*')
      .eq('display_id', DISPLAY_ID)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(20)
    if (e) { warn('fetch pending failed:', e.message); return }
    if (!pending || pending.length === 0) return

    log(`Processing ${pending.length} pending command(s)`)
    for (const cmd of pending) {
      try {
        const result = await applyCommand(cmd.command, cmd.payload)
        await supabase
          .from('display_commands')
          .update({ status: 'done', executed_at: new Date().toISOString() })
          .eq('id', cmd.id)
        log(`✓ ${cmd.command}`, result)
      } catch (e) {
        const message = e?.message ?? String(e)
        err(`✗ ${cmd.command} failed:`, message)
        await supabase
          .from('display_commands')
          .update({ status: 'error', error: message, executed_at: new Date().toISOString() })
          .eq('id', cmd.id)
        dropSession('command failed, will reopen on next call')
      }
    }
  } finally {
    processing = false
  }
}

// ---- realtime ----
function subscribeRealtime() {
  const channel = supabase
    .channel(`agent-${DISPLAY_ID}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'display_commands', filter: `display_id=eq.${DISPLAY_ID}` },
      () => { processPending().catch(e => err('processPending error:', e)) },
    )
    .subscribe(status => {
      log(`Realtime status: ${status}`)
    })
  return channel
}

// ---- periodic loop: heartbeat + HDMI signal + scheduler + safety poll ----
async function readHasSignal() {
  try {
    await ensureSession()
    if (typeof native?.ReadIsHasDVI !== 'function') return null
    const has = await native.ReadIsHasDVI(session, 0)
    return Boolean(has)
  } catch (e) {
    warn('ReadIsHasDVI failed:', e?.message ?? e)
    dropSession('signal read failed')
    return null
  }
}

async function runScheduler(display) {
  if (!display?.schedule_enabled) return
  const now = new Date()
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const on  = (display.schedule_on  || '').slice(0, 5)
  const off = (display.schedule_off || '').slice(0, 5)
  const desired =
    on && off
      ? (on <= off
          ? (hhmm >= on && hhmm < off ? 'on' : 'off')              // same-day window (e.g. 08-22)
          : (hhmm >= on || hhmm < off ? 'on' : 'off'))             // overnight window (e.g. 18-02)
      : null
  if (!desired) return
  if (display.power_state === desired) return
  log(`Scheduler: ${hhmm} → ${desired.toUpperCase()}`)
  await supabase.from('display_commands').insert({
    display_id: DISPLAY_ID,
    command: desired === 'on' ? 'power_on' : 'power_off',
    payload: desired === 'on' ? { brightness: display.brightness ?? 80 } : null,
  })
}

async function periodicTick() {
  try {
    // Read fresh display row (for scheduler + agent_ip)
    const { data: display } = await supabase
      .from('displays')
      .select('*')
      .eq('id', DISPLAY_ID)
      .single()

    const hasSignal = await readHasSignal()

    await supabase.from('displays').update({
      agent_last_seen: new Date().toISOString(),
      agent_ip: TB50_IP,
      ...(hasSignal !== null ? { has_signal: hasSignal } : {}),
    }).eq('id', DISPLAY_ID)

    if (display) await runScheduler(display)
    await processPending()
  } catch (e) {
    err('periodicTick error:', e?.message ?? e)
  }
}

// ---- main ----
async function main() {
  log(`Starting agent for display=${DISPLAY_ID}, TB50=${TB50_IP ?? 'auto'}`)
  try { await ensureSession() } catch { /* keep going, retry on next tick */ }

  subscribeRealtime()
  await periodicTick()
  setInterval(periodicTick, 60_000)

  // Initial drain in case there are old pending commands
  await processPending()
}

main().catch(e => {
  err('Fatal:', e?.stack ?? e)
  process.exit(1)
})

// Graceful shutdown so systemd can restart cleanly
function shutdown() {
  log('Shutting down...')
  dropSession('shutdown')
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
