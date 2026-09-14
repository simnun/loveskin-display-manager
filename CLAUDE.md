@AGENTS.md

# LoveSkin Display Manager — istruzioni di lavoro

Digital signage dei negozi LoveSkin: pannello admin su Vercel, player in Chrome
kiosk su Raspberry, controllo del LED wall via agent Node.
**Architettura, modello dati, variabili d'ambiente e problemi noti: vedi
[`README.md`](README.md).** Qui c'è solo ciò che serve per non fare danni.

## Questo sistema è in produzione su schermi accesi in negozio

Ogni push su `main` va live. Si lavora **sempre su branch**; il merge in `main`
è una decisione dell'utente, non un passaggio di routine: chiedere prima.

Non esiste nessuno che ricarichi una pagina in negozio. Un player che si pianta
resta piantato finché qualcuno non va fisicamente sul posto.

## Invarianti da non rompere

1. **Bozza → pubblicato.** `playlist_items` è la bozza, `published_items` è il
   vivo. Nessuna modifica alla bozza deve raggiungere uno schermo prima della
   pubblicazione esplicita.
2. **Niente Realtime sul player.** Poll leggero ogni 60s su
   `displays.updated_at`. Non aggiungere WebSocket a `/display/[id]`.
   (L'admin usa Realtime: lì va bene.)
3. **Il service worker è additivo.** Può solo aggiungere resilienza, mai
   peggiorare il percorso di rete normale. In particolare:
   - non alzare `CACHE_VERSION` senza motivo reale — `activate` cancella le
     cache con versione diversa, svuotando la copia locale di tutti gli schermi;
   - non cancellare file dalla cache quando un download è fallito;
   - attenzione alle `fetch()` fatte dal SW: partono in mode `cors`, mentre
     `<img>`/`<video>` nativi usano `no-cors`. Rifare una richiesta dal SW può
     rompere un caso che funzionava.

## Prima di ogni commit

```bash
npx tsc --noEmit && npm run lint && npm run build
```

`npm run lint` riporta **4 errori `react-hooks/set-state-in-effect` preesistenti
su `main`**. Confrontare il conteggio con `main` prima di attribuirsene uno.
`npm run build` richiede le `NEXT_PUBLIC_*` valorizzate (bastano valori fittizi).

## Cosa NON è raggiungibile da una sessione

La rete di queste sessioni blocca Vercel, Cloudflare/R2 e Supabase. Non è una
questione di credenziali: **non si possono verificare variabili d'ambiente,
policy CORS, stato del bucket o dati su Supabase**. Quando una diagnosi dipende
da uno di questi, dirlo e chiedere all'utente di guardare, senza inventare
ipotesi presentate come fatti.

L'utente non è uno sviluppatore: niente comandi da terminale nelle istruzioni
per lui, e istruzioni per i pannelli esterni click per click.

## Trappole già incontrate

- `proxy.ts` è il vecchio `middleware.ts` (rinominato in Next 16). Copre solo
  `/admin/:path*`: le server action invocate da route pubbliche non ci passano.
- `NEXT_PUBLIC_*` sono incastonate a build time: cambiarle richiede un Redeploy.
- Il nome della service key differisce fra web (`SUPABASE_SERVICE_ROLE_KEY`) e
  agent (`SUPABASE_SERVICE_KEY`).
- Il trigger `displays_updated_at` scatta a **ogni** UPDATE di `displays`,
  telemetria dell'agent compresa.
