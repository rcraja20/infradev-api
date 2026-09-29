/* ==========================================================
   INFRADEV-API — Cloudflare Worker (backend)

   Secrets this Worker needs (Cloudflare Dashboard → infradev-api →
   Settings → Variables and Secrets — mark each as "Secret", not
   "Text", except ALLOWED_ORIGINS which is a plain variable):

     ALLOWED_ORIGINS        e.g. https://infradev-3h7.pages.dev,http://localhost:8788
     FIREBASE_PROJECT_ID    from the service account JSON
     FIREBASE_CLIENT_EMAIL  from the service account JSON
     FIREBASE_PRIVATE_KEY   from the service account JSON (the whole
                             -----BEGIN PRIVATE KEY----- block)
     DISCORD_CLIENT_ID      from the Discord Developer Portal
     DISCORD_CLIENT_SECRET  from the Discord Developer Portal
     TELEGRAM_BOT_TOKEN     optional — for support-message alerts
     TELEGRAM_CHAT_ID       optional — your own chat/user id

   Routes:
     GET  /health
     POST /admin/verify        -> { isAdmin: boolean }
     POST /admin/set-role      -> admin-only, promotes/demotes a user
     POST /support/notify      -> pings you on Telegram for a new message
     GET  /auth/discord/start
     GET  /auth/discord/callback
   ========================================================== */

import { verifyIdToken, mintCustomToken, setCustomUserClaims } from './firebase-admin.js';

function corsHeaders(origin, env) {
  const allowed = env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
  const allow = allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function bearerToken(request) {
  const authHeader = request.headers.get('Authorization') || '';
  return authHeader.replace('Bearer ', '');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    // ---------- GET /health ----------
    if (url.pathname === '/health') {
      return json({ ok: true, service: 'infradev-api' }, 200, headers);
    }

    // ---------- POST /admin/verify ----------
    if (url.pathname === '/admin/verify' && request.method === 'POST') {
      const payload = await verifyIdToken(bearerToken(request), env);
      const isAdmin = !!payload && payload.admin === true;
      return json({ isAdmin }, 200, headers);
    }

    // ---------- POST /admin/set-role ----------
    // Body: { targetUid: string, makeAdmin: boolean }
    if (url.pathname === '/admin/set-role' && request.method === 'POST') {
      const caller = await verifyIdToken(bearerToken(request), env);
      if (!caller || caller.admin !== true) {
        return json({ error: 'Forbidden' }, 403, headers);
      }

      const { targetUid, makeAdmin } = await request.json();
      if (!targetUid) return json({ error: 'targetUid required' }, 400, headers);

      try {
        await setCustomUserClaims(targetUid, { admin: !!makeAdmin }, env);
        return json({ ok: true, targetUid, makeAdmin: !!makeAdmin }, 200, headers);
      } catch (err) {
        return json({ error: err.message }, 500, headers);
      }
    }

    // ---------- POST /support/notify ----------
    if (url.pathname === '/support/notify' && request.method === 'POST') {
      const { name, email, text } = await request.json();

      if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
        try {
          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: env.TELEGRAM_CHAT_ID,
              text: `New InfraDev support message\nFrom: ${name} (${email})\n\n${text}`,
            }),
          });
        } catch (err) {
          console.log('Telegram notify failed:', err.message);
        }
      }

      return json({ ok: true }, 200, headers);
    }

    // ---------- GET /auth/discord/start ----------
    if (url.pathname === '/auth/discord/start') {
      const redirectTo = url.searchParams.get('redirect') || 'https://infradev-3h7.pages.dev/';
      const state = encodeURIComponent(redirectTo);
      const callbackUrl = `${url.origin}/auth/discord/callback`;

      const discordAuthUrl =
        `https://discord.com/api/oauth2/authorize` +
        `?client_id=${env.DISCORD_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
        `&response_type=code` +
        `&scope=identify%20email` +
        `&state=${state}`;

      return Response.redirect(discordAuthUrl, 302);
    }

    // ---------- GET /auth/discord/callback ----------
    if (url.pathname === '/auth/discord/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const redirectTo = state ? decodeURIComponent(state) : 'https://infradev-3h7.pages.dev/';
      if (!code) return json({ error: 'Missing code' }, 400, headers);

      const callbackUrl = `${url.origin}/auth/discord/callback`;

      try {
        // Step 1: exchange the code for a Discord access token
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: env.DISCORD_CLIENT_ID,
            client_secret: env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: callbackUrl,
          }),
        });
        if (!tokenRes.ok) throw new Error('token exchange failed: ' + (await tokenRes.text()));
        const { access_token } = await tokenRes.json();

        // Step 2: fetch the Discord user's own profile (their OAuth
        // token, NOT the bot token — the bot token is unrelated to login)
        const profileRes = await fetch('https://discord.com/api/users/@me', {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        if (!profileRes.ok) throw new Error('profile fetch failed: ' + (await profileRes.text()));
        const discordUser = await profileRes.json();

        // Step 3: mint a Firebase custom token for this Discord user
        const uid = `discord:${discordUser.id}`;
        const customToken = await mintCustomToken(uid, {
          provider: 'discord',
          name: discordUser.global_name || discordUser.username,
          avatar: discordUser.avatar
            ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
            : null,
          email: discordUser.email || null,
        }, env);

        return Response.redirect(`${redirectTo}#customToken=${customToken}`, 302);
      } catch (err) {
        console.log('Discord callback failed:', err.message);
        return Response.redirect(`${redirectTo}#discordError=1`, 302);
      }
    }

    // ---------- POST /admin/bootstrap ----------
    // One-time-use route to create your FIRST admin (there's no other
    // way in — /admin/set-role requires an existing admin to call it).
    // Protected by a secret you set once, not by an admin check.
    // Body: { targetUid: string }
    // Header: X-Bootstrap-Secret: <ADMIN_BOOTSTRAP_SECRET>
    //
    // After you've made yourself admin once, remove the
    // ADMIN_BOOTSTRAP_SECRET Worker secret (or change its value) so
    // this route stops working — it should never stay usable.
    if (url.pathname === '/admin/bootstrap' && request.method === 'POST') {
      const secret = request.headers.get('X-Bootstrap-Secret');
      if (!env.ADMIN_BOOTSTRAP_SECRET || secret !== env.ADMIN_BOOTSTRAP_SECRET) {
        return json({ error: 'Forbidden' }, 403, headers);
      }

      const { targetUid } = await request.json();
      if (!targetUid) return json({ error: 'targetUid required' }, 400, headers);

      try {
        await setCustomUserClaims(targetUid, { admin: true }, env);
        return json({ ok: true, targetUid }, 200, headers);
      } catch (err) {
        return json({ error: err.message }, 500, headers);
      }
    }

    return json({ error: 'Not found' }, 404, headers);
  },
};
