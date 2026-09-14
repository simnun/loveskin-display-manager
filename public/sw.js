// Loveskin Display - Service Worker
// Caches R2 media + app shell so displays survive offline (after first successful online load).
//
// Regola di fondo: il service worker è ADDITIVO. Può solo aggiungere (servire dalla
// cache quando la rete manca); non deve MAI peggiorare il percorso di rete normale.
// Uno schermo in negozio non ha nessuno che ricarica la pagina.

// NB: non alzare CACHE_VERSION senza motivo. L'handler `activate` cancella le cache
// con versione diversa: un bump svuota la copia locale di tutti gli schermi in campo,
// che è esattamente ciò da cui questo SW deve proteggere.
const CACHE_VERSION = 'v2'
const MEDIA_CACHE = `loveskin-media-${CACHE_VERSION}`
const APP_CACHE = `loveskin-app-${CACHE_VERSION}`

// Host di default del bucket R2. Resta come fallback, ma gli origin veri vengono
// imparati dagli URL che il player manda con PREPARE_PLAYLIST: così se cambia
// NEXT_PUBLIC_R2_PUBLIC_URL (dominio custom) il SW continua a funzionare.
const R2_HOST = 'pub-7f82d9c7ae014d95a9ef1d16918c3604.r2.dev'
const mediaOrigins = new Set([`https://${R2_HOST}`])

// Guardia anti-deadlock: se non arrivano nemmeno gli header entro questo tempo,
// la richiesta è appesa e va abortita. Il BODY invece scarica senza limite di tempo
// (un video può pesare GB su una linea lenta).
const HEADERS_TIMEOUT_MS = 30_000

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

  if (mediaOrigins.has(url.origin)) {
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

// Media: serviamo SOLO ciò che abbiamo già in cache (popolata da preparePlaylist).
//
// Se il file non è in cache lasciamo passare la richiesta originale intatta, senza
// rifarla noi. È il punto chiave: una `fetch(url)` fatta dal SW parte in mode 'cors'
// e senza header Access-Control-Allow-Origin sul bucket viene rigettata dal browser —
// il che romperebbe anche la riproduzione diretta, che nativamente (<img>/<video>
// senza attributo crossorigin) girerebbe benissimo in mode 'no-cors'.
// Non intercettando, il caso peggiore è "come se il SW non ci fosse".
async function handleMediaFetch(request) {
  const cache = await caches.open(MEDIA_CACHE)
  const cacheKey = new Request(request.url, { method: 'GET' })
  const cached = await cache.match(cacheKey)

  if (!cached) return fetch(request)

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

// Scarica un file con timeout sui soli header: se il server non risponde entro
// HEADERS_TIMEOUT_MS abortiamo, altrimenti lasciamo scaricare il body senza limiti.
async function fetchWithHeadersTimeout(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HEADERS_TIMEOUT_MS)
  try {
    return await fetch(url, { cache: 'no-store', signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function preparePlaylist(urls, port) {
  let downloaded = 0, reused = 0, failed = 0
  const failedUrls = []
  let removed = 0

  try {
    // Impara gli origin dei media, così l'handler `fetch` sa cosa intercettare
    // anche se l'URL pubblico di R2 non è più quello hardcoded qui sopra.
    for (const url of urls) {
      try { mediaOrigins.add(new URL(url).origin) } catch { /* URL non valido, ignora */ }
    }

    const cache = await caches.open(MEDIA_CACHE)

    await Promise.all(urls.map(async url => {
      try {
        const match = await cache.match(url)
        if (match) { reused++; return }
        const response = await fetchWithHeadersTimeout(url)
        if (!response.ok) { failed++; failedUrls.push(url); return }
        // `cache.put(response)` senza clone: clonare un video da GB significa
        // tenerne due copie in RAM sul Raspberry.
        await cache.put(url, response)
        downloaded++
      } catch {
        failed++
        failedUrls.push(url)
      }
    }))

    // Pulizia dei file non più in scaletta SOLO se abbiamo scaricato tutto.
    // Se anche un solo download è fallito, la scaletta nuova non è riproducibile
    // e quella vecchia è l'unica cosa che tiene vivo lo schermo: non si tocca.
    if (failed === 0) {
      const currentSet = new Set(urls)
      const keys = await cache.keys()
      await Promise.all(keys.map(async req => {
        if (!currentSet.has(req.url)) {
          await cache.delete(req)
          removed++
        }
      }))
    }
  } catch {
    // Errore inatteso (quota superata, storage non disponibile...): non possiamo
    // restare zitti, o il player aspetta PREPARE_DONE per sempre.
    failed = failed || urls.length
  }

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
