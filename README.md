# infradev-api

Backend for InfraDev — a Cloudflare Worker. The frontend (Cloudflare
Pages) calls this over HTTPS. All secret keys live here and nowhere
else.

## Deploying

This repo is connected to Cloudflare via Git integration — pushing to
`main` auto-deploys. To deploy manually instead:

```
npm install -g wrangler
wrangler login
cd infradev-api
wrangler deploy
```

## Required secrets

**Fastest way — one script instead of typing each one into the dashboard:**

1. Copy `.env.secrets.example` to `.env.secrets`
2. Fill in your real values (see the table below for where each comes from)
3. Run:
   ```
   chmod +x setup-secrets.sh
   ./setup-secrets.sh
   ```
   This pushes every value to Cloudflare in one go via `wrangler secret put`. It'll ask you to log in to Cloudflare (`wrangler login`) the first time if you haven't already.
4. **Delete `.env.secrets` (or blank it out) right after** — it holds real secrets in plain text on disk. It's already gitignored so it can't be committed, but don't leave it lying around either.

**Or set them one by one** in Cloudflare Dashboard → Workers & Pages →
infradev-api → Settings → Variables and Secrets. Mark every one below
as **Secret** (not Text) so the value is hidden after saving — except
`ALLOWED_ORIGINS`, which is a plain variable.

| Name | Where to get it |
|---|---|
| `ALLOWED_ORIGINS` | Your frontend URL(s), comma-separated, e.g. `https://infradev-3h7.pages.dev,http://localhost:8788` |
| `FIREBASE_PROJECT_ID` | Firebase service account JSON → `project_id` |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account JSON → `client_email` |
| `FIREBASE_PRIVATE_KEY` | Firebase service account JSON → `private_key` (paste the whole `-----BEGIN PRIVATE KEY-----...` block, including line breaks) |
| `DISCORD_CLIENT_ID` | Discord Developer Portal → your app → OAuth2 |
| `DISCORD_CLIENT_SECRET` | Discord Developer Portal → your app → OAuth2 |
| `TELEGRAM_BOT_TOKEN` | Optional — only if you want a Telegram ping on new support messages |
| `TELEGRAM_CHAT_ID` | Optional — same as above |
| `ADMIN_BOOTSTRAP_SECRET` | Any random string you make up — used exactly once, see below |

## Making yourself the first admin

`/admin/set-role` requires you to already be an admin — which is a
chicken-and-egg problem for the very first one. Solve it once with
`/admin/bootstrap` instead:

1. Set the `ADMIN_BOOTSTRAP_SECRET` secret to any random string.
2. Sign up / log in on the site normally with your own account.
3. Find your Firebase `uid`: Firebase Console → Authentication → Users
   tab → copy the "User UID" next to your account.
4. Send one request (from your phone's browser console, Postman, or
   just ask an AI assistant with internet/shell access to run it):

   ```
   curl -X POST https://infradev-api.rcempire.workers.dev/admin/bootstrap \
     -H "X-Bootstrap-Secret: <the random string from step 1>" \
     -H "Content-Type: application/json" \
     -d '{"targetUid":"<your uid from step 3>"}'
   ```

5. **Change or delete `ADMIN_BOOTSTRAP_SECRET` right after** — this
   route has no other protection, so it must not stay usable.
6. Log out and back in on the site (so your ID token picks up the new
   `admin` claim), then `/admin-support/` will let you in.

Every admin after this first one can be set normally through
`/admin/set-role`, which does require the caller to already be an
admin.


**Getting the Firebase service account JSON:** Firebase Console →
Project Settings (gear icon) → Service Accounts tab → **Generate new
private key**. This downloads a JSON file — open it and copy the three
fields above into Cloudflare. Never commit this JSON file anywhere.

**Discord redirect URI to register in the Discord Developer Portal:**
```
https://infradev-api.rcempire.workers.dev/auth/discord/callback
```

## What each route does

- `GET /health` — confirms the Worker is alive
- `POST /admin/verify` — checks the caller's Firebase ID token for an `admin` custom claim
- `POST /admin/set-role` — admin-only, promotes/demotes another user (`{ targetUid, makeAdmin }`)
- `POST /admin/bootstrap` — one-time-use, creates your first admin (see below)
- `POST /support/notify` — optional Telegram alert when a user sends a support message
- `GET /auth/discord/start` — redirects the browser into Discord's OAuth flow
- `GET /auth/discord/callback` — exchanges the code, fetches the Discord profile, mints a Firebase custom token, and redirects back to the frontend with it in the URL hash

## Local testing

```
wrangler dev
```

Runs the Worker on `http://localhost:8787`.
