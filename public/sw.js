// Loveskin Display - Service Worker
// Caches R2 media + app shell so displays survive offline (after first successful online load).

const CACHE_VERSION = 'v2'
const MEDIA_CACHE = `loveskin-media-${CACHE_VERSION}`
const APP_CACHE = `loveskin-app-${CACHE_VERSION}`
const R2_HOST = 'pub-7f82d9c7ae014d95a9ef1d16918c3604.r2.dev'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(
      keys
        .filter(k => (k.startsWith('loveskin-media-') || k.startsWith('loveskin-app-'))
                   && k !== MEDIA_CACHE && k !== APP_CACHE)
        .map(k => caches.delete(k))
    )
    await self.clients.claim()
  })())
})

function shouldCacheAppShell(url) {
  if (url.pathname === '/sw.js') return false
  if (url.pathname.startsWith('/api/')) return false
  if (url.pathname.startsWith('/_next/data/')) return false
  if (url.pathname.startsWith('/admin')) return false
  if (url.pathname === '/') return false
  if (url.pathname.startsWith('/display/')) return true
  if (url.pathname.startsWith('/_next/static/')) return true
  if (/\.(png|jpg|jpeg|svg|gif|ico|woff|woff2|ttf|webp|css|js)$/i.test(url.pathname)) return true
  return false
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)

  if (url.hostname === R2_HOST) {
    event.respondWith(handleMediaFetch(event.request))
    return
  }

  if (url.origin === self.location.origin && shouldCacheAppShell(url)) {
    event.respondWith(handleAppShellFetch(event.request))
  }
})

async function handleAppShellFetch(request) {
  const cache = await caches.open(APP_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response.ok && response.status === 200) {
      cache.put(request, response.clone()).catch(() => {})
    }
    return response
  } catch {
    return new Response('Offline e nessuna copia in cache', { status: 503 })
  }
}

async function handleMediaFetch(request) {
  const cache = await caches.open(MEDIA_CACHE)
  const cacheKey = new Request(request.url, { method: 'GET' })
  let cached = await cache.match(cacheKey)

  if (!cached) {
    try {
      const response = await fetch(request.url)
      if (response.ok && response.status === 200) {
        await cache.put(cacheKey, response.clone())
        cached = await cache.match(cacheKey)
      } else {
        return response
      }
    } catch {
      return new Response('Offline and not cached', { status: 503 })
    }
  }

  const rangeHeader = request.headers.get('range')
  if (!rangeHeader) return cached.clone()

  const buffer = await cached.arrayBuffer()
  const total = buffer.byteLength
  const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader)
  if (!match) return cached.clone()

  const start = parseInt(match[1], 10)
  const end = match[2] ? parseInt(match[2], 10) : total - 1
  if (start >= total) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } })
  }
  const slice = buffer.slice(start, end + 1)

  return new Response(slice, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': cached.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': String(slice.byteLength),
      'Accept-Ranges': 'bytes',
    },
  })
}

self.addEventListener('message', event => {
  const data = event.data
  if (!data) return

  if (data.type === 'PREPARE_PLAYLIST') {
    event.waitUntil(preparePlaylist(data.urls || [], event.ports && event.ports[0]))
  }
})

async function preparePlaylist(urls, port) {
  const cache = await caches.open(MEDIA_CACHE)
  let downloaded = 0, reused = 0, failed = 0
  const failedUrls = []

  await Promise.all(urls.map(async url => {
    try {
      const match = await cache.match(url)
      if (match) { reused++; return }
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) { failed++; failedUrls.push(url); return }
      await cache.put(url, response.clone())
      downloaded++
    } catch {
      failed++
      failedUrls.push(url)
    }
  }))

  const currentSet = new Set(urls)
  const keys = await cache.keys()
  let removed = 0
  await Promise.all(keys.map(async req => {
    if (!currentSet.has(req.url)) {
      await cache.delete(req)
      removed++
    }
  }))

  if (port) {
    port.postMessage({
      type: 'PREPARE_DONE',
      total: urls.length,
      downloaded,
      reused,
      failed,
      failedUrls,
      removed,
    })
  }
}
