# infradev-api

Backend for Infradev — a Cloudflare Worker. The frontend (Cloudflare
Pages) calls this over HTTPS; this is the only place secret keys
should live.

## Deploy

```
npm install -g wrangler
wrangler login
cd infradev-api
wrangler deploy
```

This deploys to the URL you already have:
`https://infradev-api.rcempire.workers.dev`

## Setting secrets

Never put real keys in `wrangler.toml`. Set them like this instead:

```
wrangler secret put FIREBASE_PROJECT_ID
wrangler secret put FIREBASE_CLIENT_EMAIL
wrangler secret put FIREBASE_PRIVATE_KEY
```

Wrangler will prompt you to paste each value — it stores them
encrypted on Cloudflare's side, not in your repo.

## What's real vs. a TODO right now

- CORS, routing, and the `/health` endpoint work as-is.
- `verifyIdToken`, the Firebase Admin claim check, and the Telegram
  notify call are stubbed with `// TODO` comments showing exactly
  what to fill in and which package (`jose`) to use — see
  `src/index.js`.

## Local testing

```
wrangler dev
```

This runs the Worker on `http://localhost:8787` so you can test
`fetch()` calls from the frontend before deploying.
