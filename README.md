# LoveSkin Display Manager

Sistema di digital signage dei negozi LoveSkin.

Da un pannello admin si caricano foto e video, si compone la scaletta di ogni
schermo, la si pubblica, e gli schermi in negozio la riproducono in loop.
Da giugno 2026 gestisce anche accensione, luminosità e orari del LED wall.

---

## Architettura

```
  Admin (Next.js su Vercel)
     ├─► Supabase (Postgres + Auth)      stato, scalette, coda comandi
     ├─► Cloudflare R2                   file media, upload con URL presigned
     ├─► /display/[id] → Chrome in kiosk su Raspberry   = il player
     └─► display_commands → agent Node sul Raspberry → NovaStar TB50 (TCP) → pannelli LED
```

Tre processi distinti:

1. **Admin** — `/admin`, protetto da login Supabase. Gestisce display, media e scalette.
2. **Player** — `/display/[id]`, aperto in Chrome kiosk sul Raspberry di ogni negozio.
   Nessun login: legge in sola lettura con la chiave anon.
3. **Agent** — servizio systemd sul Raspberry (`raspberry-agent/`). Parla col
   controller LED TB50 sulla LAN. Il TB50 non è mai esposto a internet.

---

## Avvio in locale

```bash
npm install
npm run dev
```

Serve un `.env.local` nella root, da creare a mano con le variabili elencate
in [Variabili d'ambiente](#vercel) (nella root non c'è un `.env.example`: l'unico
presente è quello dell'agent, in `raspberry-agent/`).

Poi `http://localhost:3000/admin`.

Verifiche prima di ogni commit:

```bash
npx tsc --noEmit    # tipi
npm run lint        # eslint
npm run build       # build di produzione
```

> Nota: `npm run lint` riporta 4 errori `react-hooks/set-state-in-effect`
> preesistenti su `main`. Non sono regressioni: prima di attribuirsene uno,
> confrontare con il conteggio su `main`.

---

## Mappa del repo

| Percorso | Cosa fa |
|---|---|
| `app/admin/AdminDashboard.tsx` | Il pannello: schermi, media, scaletta, controlli LED |
| `app/admin/login/page.tsx` | Login |
| `app/actions.ts` | Server action: login, CRUD display, upload, playlist, pubblicazione, comandi LED |
| `app/display/[id]/page.tsx` | Fetch iniziale lato server della scaletta pubblicata |
| `app/display/[id]/DisplayPlayer.tsx` | Il player che gira in kiosk |
| `proxy.ts` | Protegge `/admin/*`, redirect al login |
| `lib/r2.ts` | URL presigned per l'upload, delete su R2 |
| `lib/supabase/{client,server,admin}.ts` | I tre client Supabase (browser, server, service role) |
| `lib/types.ts` | Tipi condivisi delle tabelle |
| `public/sw.js` | Service worker: cachea media e app shell |
| `raspberry-agent/` | Agent Node sul Raspberry (systemd) |
| `supabase/migrations/` | Tre migration: initial_schema, storage_policies, led_control |

`proxy.ts` è il vecchio `middleware.ts`: in Next 16 la convenzione è stata
rinominata in `proxy`, e `middleware` è deprecato.

---

## Modello dati

Supabase, progetto `tydgfavxnxdyrxxehxkt`.

| Tabella | Ruolo |
|---|---|
| `displays` | Uno schermo. Include stato LED wall e telemetria dell'agent |
| `media` | File caricati su R2, per display. La chiave R2 è `{display_id}/{filename}` |
| `playlist_items` | La **bozza** della scaletta |
| `published_items` | Quello che va **in onda** |
| `display_commands` | Coda di comandi verso l'agent (`pending` → `done`/`error`) |

**RLS attiva su tutte.** Autenticati in scrittura; `anon` in sola lettura su
`displays`, `media`, `published_items` — così il player non ha bisogno di login.
`display_commands` non è leggibile da `anon`: l'agent usa la service key.

Un trigger `displays_updated_at` aggiorna `displays.updated_at` a ogni UPDATE
della riga.

---

## Scelte di fondo da rispettare

Non sono dettagli implementativi: sono i vincoli che tengono in piedi il sistema.

**1. Bozza → pubblicato.** La scaletta si modifica con calma su `playlist_items`;
gli schermi cambiano solo quando si preme "Pubblica scaletta", che riscrive
`published_items`. Nessuna modifica alla bozza deve mai raggiungere uno schermo.

**2. Niente Realtime sul player.** Poll leggero ogni 60s su `displays.updated_at`
(~500B), fetch completo solo se è cambiato. Scelto apposta per non tenere
WebSocket aperti sugli schermi. L'admin invece usa Realtime, e va bene così.

**3. Il service worker deve garantire che uno schermo già avviato continui a
funzionare anche senza rete.** È il requisito più importante del progetto: in
negozio nessuno va a ricaricare la pagina. Conseguenze pratiche:

- Il SW è **additivo**: può solo aggiungere (servire dalla cache quando la rete
  manca), mai peggiorare il percorso di rete normale.
- `CACHE_VERSION` in `public/sw.js` non va alzata senza un motivo reale:
  l'handler `activate` cancella le cache con versione diversa, quindi un bump
  svuota la copia locale di **tutti** gli schermi in campo.
- I file in cache non vanno cancellati quando un download fallisce: la copia
  vecchia è l'unica cosa che tiene vivo lo schermo.

---

## Variabili d'ambiente

### Vercel

| Variabile | Note |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | |
| `NEXT_PUBLIC_R2_PUBLIC_URL` | URL pubblico del bucket, **senza `/` finale** |
| `SUPABASE_SERVICE_ROLE_KEY` | Usata da `lib/supabase/admin.ts`. Segreta |
| `R2_ENDPOINT` | |
| `R2_ACCESS_KEY_ID` | Segreta |
| `R2_SECRET_ACCESS_KEY` | Segreta |
| `R2_BUCKET` | |

⚠️ Le `NEXT_PUBLIC_*` vengono **incastonate nel bundle a build time**.
Cambiarne una non ha effetto finché non si fa un **Redeploy**.

`NEXT_PUBLIC_BUILD_TIME` **non** è una variabile di Vercel: la genera
`next.config.ts` a ogni build. Serve solo per la scritta di versione nel login.

### Raspberry (`/opt/loveskin-agent/.env`)

| Variabile | Note |
|---|---|
| `SUPABASE_URL` | |
| `SUPABASE_SERVICE_KEY` | Service role key. Segreta. **Nome diverso** da quello usato sul web (`SUPABASE_SERVICE_ROLE_KEY`) |
| `DISPLAY_ID` | Il display a cui questo Raspberry è legato |
| `TB50_IP` | IP del controller LED sulla LAN. Vuoto = autodiscovery |

---

## Deploy

Vercel è collegato a GitHub: **ogni push su `main` va in produzione**, su schermi
accesi in negozio. Si lavora su branch; il merge in `main` è una decisione
consapevole, non un passaggio di routine.

Gli schermi già accesi prendono il service worker nuovo da soli entro pochi
secondi dal deploy, senza perdere i file già in cache (a patto di non aver
cambiato `CACHE_VERSION`).

---

## LED wall (NovaStar TB50)

Documentazione operativa completa in [`raspberry-agent/README.md`](raspberry-agent/README.md):
installazione, systemd, log, e lo script diagnostico `test.mjs` da lanciare
prima di mettere in servizio l'agent.

Flusso di un comando: l'admin inserisce una riga in `display_commands` →
l'agent la riceve (Realtime, più un poll di sicurezza ogni 60s) → la traduce in
una chiamata al TB50 dentro `applyCommand()` → segna la riga `done` o `error`.

`applyCommand()` è l'unico punto che sa parlare col TB50. Ogni nuovo comando si
aggiunge lì.

**Attenzione:** `power_off` porta la luminosità a 0 — i pannelli diventano neri
ma **restano alimentati** (ventole accese). Per un taglio vero della corrente
serve una NovaStar Multifunction Card con relè.

---

## Problemi noti

Nessuno di questi è in lavorazione. Sono verificati leggendo il codice.

### Sicurezza

- **Server action senza controllo di autenticazione.** In `app/actions.ts` solo
  `getUploadUrlAction` verifica l'utente; tutte le altre usano direttamente la
  service role key, che bypassa la RLS. `proxy.ts` copre solo `/admin/:path*`,
  ma una server action invocata da `/display/[id]` (pubblica) non passa di lì.
  In pratica si può cancellare un display o spegnere il LED wall senza login.
- **Credenziali precompilate in `app/admin/login/page.tsx`.** Email e password
  sono costanti in un client component, quindi finiscono nel JavaScript
  pubblico. Vanno rimosse e la password va cambiata su Supabase.

### Correttezza

- **L'heartbeat annulla il poll leggero.** L'agent scrive `agent_last_seen` su
  `displays` ogni 60s; il trigger bumpa `updated_at`; il player vede sempre un
  valore nuovo e fa **sempre** il fetch completo. La scelta di fondo n. 2 è di
  fatto disattivata su ogni display che ha un agent.
- **Lo scheduler accoda comandi all'infinito.** `runScheduler()` confronta
  `display.power_state` con lo stato desiderato, ma nessuno aggiorna
  `power_state` dopo l'esecuzione lato agent: allo scattare dell'orario viene
  inserito un comando **al minuto, per sempre**. `display_commands` cresce senza
  limite e la UI mostra lo stato sbagliato.
- **`power_on` non ripristina la luminosità salvata**: `sendDisplayCommand` non
  passa il payload, quindi l'agent riaccende sempre all'80%.
- **`display_commands` non ha retention**: nessuno cancella le righe vecchie.

### Infrastruttura

- **Nessun backup configurato su Supabase.**
- Il dashboard Supabase segna come ultima migration `storage_policies`: va
  verificato che `led_control` sia davvero applicata in produzione.

### Cosmetici

- `app/layout.tsx` carica Geist, ma `app/globals.css` dichiara DM Sans come
  `--font-dm-sans`: `font-sans` cade sul fallback di sistema.
- `app/layout.tsx` ha ancora i metadata "Create Next App".
