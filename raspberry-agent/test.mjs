#!/usr/bin/env node
/**
 * Loveskin NovaStar Agent — test script
 *
 * Run this on the Raspberry to verify what the TB50 actually responds to,
 * before finalizing applyCommand() in agent.mjs.
 *
 * Usage:
 *   node test.mjs                  # auto-discover device on the LAN
 *   TB50_IP=192.168.1.40 node test.mjs   # connect to a specific IP
 *
 * The script tries each diagnostic step in isolation and never throws.
 * Read the printed report to know which API methods are available.
 */

import 'dotenv/config'

const TB50_IP = process.env.TB50_IP || null

const log = (...a) => console.log('[test]', ...a)
const ok  = (...a) => console.log('[ok]  ', ...a)
const err = (...a) => console.log('[err] ', ...a)

async function safe(label, fn) {
  try {
    const result = await fn()
    ok(`${label} →`, result)
    return { ok: true, result }
  } catch (e) {
    err(`${label} → FAILED: ${e?.message ?? e}`)
    return { ok: false, error: e }
  }
}

async function main() {
  log('---- 1) Load @novastar/net ----')
  let net
  try {
    net = (await import('@novastar/net')).default ?? (await import('@novastar/net'))
  } catch (e) {
    err('Cannot import @novastar/net:', e?.message ?? e)
    process.exit(1)
  }
  ok('Imported @novastar/net')

  log('---- 2) Discover devices on LAN ----')
  await safe('findNetDevices()', async () => {
    if (typeof net.findNetDevices !== 'function') {
      throw new Error('findNetDevices is not a function on net')
    }
    const devices = await net.findNetDevices()
    return devices
  })

  log('---- 3) Open session ----')
  let session
  const openResult = await safe(`net.open(${TB50_IP ?? 'auto'})`, async () => {
    if (typeof net.open !== 'function') {
      throw new Error('net.open is not a function')
    }
    session = TB50_IP ? await net.open(TB50_IP) : await net.open()
    return session ? 'session opened' : 'no session returned'
  })
  if (!openResult.ok || !session) {
    err('Cannot continue without a session')
    process.exit(1)
  }

  log('---- 4) Try @novastar/native methods ----')
  let native
  try {
    native = await import('@novastar/native')
    ok('Imported @novastar/native')
    ok('Top-level exports:', Object.keys(native).slice(0, 20).join(', '))
  } catch (e) {
    err('Cannot import @novastar/native:', e?.message ?? e)
  }

  if (native) {
    await safe('ReadIsHasDVI', async () => {
      if (typeof native.ReadIsHasDVI !== 'function')
        throw new Error('ReadIsHasDVI is not exported')
      return await native.ReadIsHasDVI(session, 0)
    })

    await safe('ReadGlobalBrightness', async () => {
      if (typeof native.ReadGlobalBrightness !== 'function')
        throw new Error('ReadGlobalBrightness is not exported')
      return await native.ReadGlobalBrightness(session, 0)
    })

    await safe('SetGlobalBrightness(0, 128)', async () => {
      if (typeof native.SetGlobalBrightness !== 'function')
        throw new Error('SetGlobalBrightness is not exported')
      return await native.SetGlobalBrightness(session, 0, 128)
    })

    await safe('SetGlobalBrightness(0, 200) (restore)', async () => {
      return await native.SetGlobalBrightness(session, 0, 200)
    })
  }

  log('---- 5) Try @novastar/screen ScreenConfigurator ----')
  try {
    const screen = await import('@novastar/screen')
    ok('Imported @novastar/screen, exports:', Object.keys(screen).slice(0, 10).join(', '))

    const ScreenConfigurator = screen.ScreenConfigurator ?? screen.default
    if (ScreenConfigurator) {
      await safe('ScreenConfigurator.WriteBrightness(0, 200)', async () => {
        const sc = new ScreenConfigurator(session)
        if (typeof sc.WriteBrightness !== 'function') throw new Error('WriteBrightness missing on ScreenConfigurator')
        return await sc.WriteBrightness(0, 200)
      })
    }
  } catch (e) {
    err('@novastar/screen unavailable:', e?.message ?? e)
  }

  log('---- 6) Close session ----')
  await safe('session.close()', async () => {
    if (typeof session.close === 'function') {
      await session.close()
      return 'closed'
    }
    return 'no close() method on session'
  })

  log('---- DONE — review the [ok]/[err] lines above ----')
  log('Findings to bring back to applyCommand():')
  log('  - Did findNetDevices() return the TB50?')
  log('  - Did ReadIsHasDVI return true/false meaningfully?')
  log('  - Did SetGlobalBrightness actually change the LED wall brightness?')
}

main().catch(e => {
  err('Fatal error:', e?.stack ?? e)
  process.exit(1)
})
