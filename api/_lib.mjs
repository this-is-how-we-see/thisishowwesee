// Shared helpers for the private-document API.
//
// This is the same admin gate as jjkind.thisishowwesee.com/manage, with the
// Neon half removed: this site has no database, so the allowlist is one
// environment variable. Secrets come from the environment, never from this
// repo (it is public) and never from browser JavaScript:
//
//   GOOGLE_CLIENT_ID        OAuth client id for sign-in
//   ALLOWED_EMAILS          comma-separated allowlist
//   BLOB_READ_WRITE_TOKEN   Vercel Blob (Vercel injects this)
//
// See .env.example for local development.

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

export function missingConfig(...names) {
  const absent = names.filter(n => !process.env[n]);
  return absent.length ? `Missing environment variable(s): ${absent.join(', ')}` : null;
}

/** Who may read the private documents. Changing it needs access to Vercel. */
export function allowedEmails() {
  return (process.env.ALLOWED_EMAILS || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}

/**
 * The gate — Sign in with Google, plus an email allowlist.
 *
 * The page signs in with Google and sends the resulting ID token as
 *   Authorization: Bearer <id_token>
 *
 * Verification is handed to Google's tokeninfo endpoint rather than verifying
 * the JWT signature here. That is one network call per request, which is
 * nothing at this traffic, and it means no JWT library to get subtly wrong.
 *
 * Checks, all of which must pass:
 *   - Google says the token is valid and unexpired
 *   - aud matches OUR client id, so a token minted for some other site is
 *     useless here
 *   - the email is verified
 *   - the email is on ALLOWED_EMAILS
 *
 * Why this beats a shared passcode: each person signs in as themselves, so
 * access can be revoked for one person without disturbing anyone else,
 * whatever two-factor they have on their Google account applies here, and
 * there is no passcode for us to store, rotate, or leak. The document itself
 * never leaves the server until one of these checks passes, which is the part
 * a client-side passcode could never do.
 *
 * Returns the signed-in email on success, or null.
 */
export async function signedInEmail(request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return null;

  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;

  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`
    );
    if (!res.ok) return null;
    const info = await res.json();

    if (info.aud !== clientId) return null;               // minted for another app
    if (String(info.email_verified) !== 'true') return null;
    if (Number(info.exp) * 1000 <= Date.now()) return null;

    const email = String(info.email || '').toLowerCase();
    return allowedEmails().includes(email) ? email : null;
  } catch {
    return null;
  }
}
