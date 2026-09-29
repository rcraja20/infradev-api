/* ==========================================================
   INFRADEV-API — Cloudflare Worker (backend)

   This is the ONLY place secret keys should ever live. The
   frontend (Cloudflare Pages) never sees them — it only calls
   these URLs with fetch().

   Routes in this starter:
     GET  /health                 -> confirms the Worker is alive
     POST /admin/verify           -> checks if a logged-in user is an admin
     POST /admin/set-role         -> (admin-only) promote/demote a user
     POST /support/notify         -> example: server-side step after a
                                      support message (e.g. send a Telegram
                                      alert to you when a user messages in)

   None of these touch Firestore directly yet — see the TODOs.
   Firestore reads/writes for chat itself (support.html, admin-support.html)
   can stay on the frontend using the Firebase client SDK, since your
   Firestore Security Rules are what actually protects that data. Put
   things HERE only when they need a secret or must not be user-editable
   (like deciding who is an admin).
   ========================================================== */

// ---------- CORS ----------
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

// ---------- Verifying who's calling ----------
// The frontend sends the user's Firebase ID token in the Authorization
// header: `Authorization: Bearer <idToken>` (get it with
// `await firebase.auth().currentUser.getIdToken()` on the frontend).
//
// To actually verify it here you need Firebase Admin credentials
// (a service account). Install firebase-admin-compatible verification
// via the `jose` library (Workers can't use the Node firebase-admin
// SDK directly) — see the TODO inside verifyIdToken below.
async function verifyIdToken(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return null;

  // TODO: verify the token's signature against Google's public keys
  // and check `aud` === env.FIREBASE_PROJECT_ID, `exp` not expired.
  // The `jose` npm package (works in Workers) can do this:
  //   import { jwtVerify, createRemoteJWKSet } from 'jose';
  //   const JWKS = createRemoteJWKSet(new URL(
  //     'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
  //   ));
  //   const { payload } = await jwtVerify(token, JWKS, {
  //     issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
  //     audience: env.FIREBASE_PROJECT_ID,
  //   });
  //   return payload; // payload.sub is the user's uid, payload.admin may exist as a custom claim

  return null; // placeholder until wired up
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin, env);

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    // ---------- GET /health ----------
    if (url.pathname === '/health') {
      return json({ ok: true, service: 'infradev-api' }, 200, headers);
    }

    // ---------- POST /admin/verify ----------
    // Frontend calls this after login to decide whether to show the
    // admin panel link / allow access to admin-support.html.
    if (url.pathname === '/admin/verify' && request.method === 'POST') {
      const payload = await verifyIdToken(request, env);
      if (!payload) return json({ isAdmin: false }, 200, headers);

      // TODO: once verifyIdToken is wired up, check a custom claim
      // or a Firestore field you set yourself (never a field the user
      // can write to their own document).
      const isAdmin = payload.admin === true;
      return json({ isAdmin }, 200, headers);
    }

    // ---------- POST /admin/set-role ----------
    // Example of an admin-only action: promote/demote a user.
    // Body: { targetUid: string, makeAdmin: boolean }
    if (url.pathname === '/admin/set-role' && request.method === 'POST') {
      const caller = await verifyIdToken(request, env);
      if (!caller || caller.admin !== true) {
        return json({ error: 'Forbidden' }, 403, headers);
      }

      const { targetUid, makeAdmin } = await request.json();
      if (!targetUid) return json({ error: 'targetUid required' }, 400, headers);

      // TODO: call the Firebase Admin REST API to set a custom claim
      // on targetUid, using a service-account-signed access token.
      // This is exactly the kind of operation that must live in a
      // Worker/server, never in the browser.
      return json({ ok: true, targetUid, makeAdmin }, 200, headers);
    }

    // ---------- POST /support/notify ----------
    // Called by support.html right after a user sends a message, so
    // you (the admin) get pinged outside the browser too.
    if (url.pathname === '/support/notify' && request.method === 'POST') {
      const { name, email, text } = await request.json();

      // TODO: send yourself an alert, e.g. via a Telegram bot:
      //   await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      //     method: 'POST',
      //     headers: { 'Content-Type': 'application/json' },
      //     body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: `New support message from ${name} (${email}): ${text}` }),
      //   });
      console.log('support message ->', name, email, text);
      return json({ ok: true }, 200, headers);
    }

    return json({ error: 'Not found' }, 404, headers);
  },
};
