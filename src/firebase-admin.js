/* ==========================================================
   INFRADEV-API — Firebase Admin helpers (no Node SDK; Workers
   can't run firebase-admin directly, so this does the same
   operations by hand with `jose` + plain REST calls.

   Needs three Worker secrets (Cloudflare Dashboard → Settings →
   Variables and Secrets, or `wrangler secret put`):
     FIREBASE_PROJECT_ID    e.g. infradev-2f815
     FIREBASE_CLIENT_EMAIL  from the downloaded service account JSON
     FIREBASE_PRIVATE_KEY   from the same JSON — paste the whole
                             "-----BEGIN PRIVATE KEY-----...END..."
                             block, newlines and all

   Get the JSON: Firebase Console → Project Settings →
   Service Accounts → Generate new private key.
   ========================================================== */

import {
  importPKCS8,
  SignJWT,
  jwtVerify,
  createRemoteJWKSet,
  decodeJwt,
} from 'jose';

// Cloudflare sometimes needs the private key's newlines re-escaped
// depending on how it was pasted into the dashboard — this handles both.
function normalizeKey(key) {
  return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
}

let cachedGoogleAccessToken = null; // { token, expiresAt } — reused across requests in the same warm Worker instance

// ---------- 1. Verify a Firebase ID token sent from the frontend ----------
// Returns the decoded payload (payload.sub = uid, custom claims like
// payload.admin) or null if invalid/expired.
export async function verifyIdToken(idToken, env) {
  if (!idToken) return null;
  try {
    const JWKS = createRemoteJWKSet(
      new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
    );
    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
      audience: env.FIREBASE_PROJECT_ID,
    });
    return payload;
  } catch (err) {
    console.log('verifyIdToken failed:', err.message);
    return null;
  }
}

// ---------- 2. Mint a Firebase custom token (for Discord sign-in) ----------
// The frontend takes this and calls signInWithCustomToken(auth, token).
export async function mintCustomToken(uid, extraClaims, env) {
  const key = await importPKCS8(normalizeKey(env.FIREBASE_PRIVATE_KEY), 'RS256');
  const now = Math.floor(Date.now() / 1000);

  return await new SignJWT({
    uid,
    claims: extraClaims || {},
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(env.FIREBASE_CLIENT_EMAIL)
    .setSubject(env.FIREBASE_CLIENT_EMAIL)
    .setAudience('https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
}

// ---------- 3. Get a Google OAuth access token for the service account ----------
// Needed to call the Identity Toolkit REST API (e.g. to set custom
// claims / promote someone to admin). Cached for reuse until it's
// close to expiring.
async function getGoogleAccessToken(env) {
  if (cachedGoogleAccessToken && cachedGoogleAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedGoogleAccessToken.token;
  }

  const key = await importPKCS8(normalizeKey(env.FIREBASE_PRIVATE_KEY), 'RS256');
  const now = Math.floor(Date.now() / 1000);

  const assertion = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/firebase',
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(env.FIREBASE_CLIENT_EMAIL)
    .setSubject(env.FIREBASE_CLIENT_EMAIL)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!res.ok) throw new Error('Failed to get Google access token: ' + (await res.text()));
  const data = await res.json();

  cachedGoogleAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

// ---------- 4. Set custom claims on a user (e.g. { admin: true }) ----------
export async function setCustomUserClaims(uid, claims, env) {
  const accessToken = await getGoogleAccessToken(env);

  const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      localId: uid,
      customAttributes: JSON.stringify(claims),
    }),
  });

  if (!res.ok) throw new Error('Failed to set custom claims: ' + (await res.text()));
  return await res.json();
}

// Handy for debugging — decodes without verifying (never trust this
// for auth decisions, only verifyIdToken's result is trustworthy).
export function unsafeDecode(token) {
  try { return decodeJwt(token); } catch { return null; }
}
