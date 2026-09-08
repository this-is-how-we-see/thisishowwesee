// The private documents themselves.
//
//   GET /api/private-doc?slug=healthcare   Bearer <google id_token>  ->  { html }
//
// This replaced a client-side passcode gate. Under that design the document
// shipped to every visitor as AES-GCM ciphertext in a public file, so a
// 4-digit passcode over a 600k-iteration payload was the only thing between a
// GPU and the plaintext — about two seconds of work. Now the bytes live in a
// PRIVATE Vercel Blob, and they leave the server only after Google says who is
// asking and the email is on ALLOWED_EMAILS.
//
// Publish or update a document with `npm run publish-private`.

import { get } from '@vercel/blob';
import { json, signedInEmail, missingConfig } from './_lib.mjs';

/**
 * slug -> blob pathname.
 *
 * A hardcoded table, NOT a pathname built from the query string. Interpolating
 * the slug into the pathname would turn this route into "read any blob in the
 * store", which is the whole store, not just the files listed here.
 */
const DOCS = {
  'healthcare': 'private/healthcare.html',
  'health-advocates': 'private/health-advocates.html',
  'budget': 'private/budget.html',
  'member': 'private/member.html',
  'aab': 'private/aab.html',
};

async function handler(request) {
  // MUST await — a bare Promise is truthy, which would open the document to
  // everyone. This is the line to read twice.
  const email = await signedInEmail(request);
  if (!email) return json({ error: 'Not authorized' }, 401);

  const problem = missingConfig('BLOB_READ_WRITE_TOKEN');
  if (problem) return json({ error: problem }, 500);

  const slug = new URL(request.url).searchParams.get('slug') || '';
  const pathname = Object.prototype.hasOwnProperty.call(DOCS, slug) ? DOCS[slug] : null;
  if (!pathname) return json({ error: 'No such document' }, 404);

  try {
    // useCache:false so an edit published a minute ago is the one that gets
    // read. These are documents people act on, not assets.
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) {
      return json({ error: 'That document is not published yet.' }, 404);
    }
    const html = await new Response(result.stream).text();
    console.log(`served ${slug} to ${email}`);
    return json({ html, email });
  } catch (err) {
    console.error(`could not read ${pathname}:`, err);
    return json({ error: 'The document could not be loaded.' }, 502);
  }
}

export { handler as GET };
