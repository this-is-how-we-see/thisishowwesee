// Public front-end configuration.
//
//   GET /api/config  ->  { googleClientId }
//
// The Google client id is public by design (it is visible in the sign-in
// button's markup either way), but serving it from here rather than hardcoding
// it means the value lives in Vercel environment variables alongside the real
// secrets, and local development works without editing any page.
//
// Nothing secret may ever be added to this response.

import { json } from './_lib.mjs';

async function handler() {
  return json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
}

export { handler as GET };
