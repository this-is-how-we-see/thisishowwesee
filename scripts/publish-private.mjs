/**
 * Publishes the passcode-free private documents to Vercel Blob.
 *
 *   npm run publish-private            upload any document whose source changed
 *   npm run publish-private -- --force upload all of them regardless
 *
 * This replaced scripts/encrypt-plan.mjs. Under that design the document was
 * committed to this repo as AES-GCM ciphertext, because the repo is public and
 * a passcode on the page hides nothing from GitHub. The ciphertext is gone: the
 * plaintext now goes to a PRIVATE blob, and api/private-doc.mjs hands it out
 * only after Google verifies the reader. Nothing about these documents is in
 * git any more, encrypted or otherwise.
 *
 * The blob pathnames here MUST match the DOCS table in api/private-doc.mjs.
 *
 * Needs BLOB_READ_WRITE_TOKEN. Get it with:
 *
 *   npx vercel env pull .env.local --scope howardseay-8349s-projects
 */

import { put } from '@vercel/blob';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DOCS = [
  { source: 'private/healthcare.src.html', pathname: 'private/healthcare.html' },
  { source: 'private/health-advocates.src.html', pathname: 'private/health-advocates.html' },
  { source: 'private/budget.src.html', pathname: 'private/budget.html' },
];

/**
 * Records a hash of each source so a repeat run can tell "unchanged" from
 * "edited" and skip the upload. It lives under private/ because it is only
 * ever a local convenience; nothing reads it at runtime.
 */
const STATE_PATH = resolve(root, 'private/.publish-state.json');

const force = process.argv.includes('--force');
const digest = (text) => createHash('sha256').update(text).digest('hex');

/** Reads KEY=value out of a .env file, without adding a dotenv dependency. */
async function loadEnvFile(name) {
  let text;
  try {
    text = await readFile(resolve(root, name), 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, '');
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

async function main() {
  await loadEnvFile('.env.local');
  await loadEnvFile('.env');

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error(
      'BLOB_READ_WRITE_TOKEN is not set. Run:\n' +
      '  npx vercel env pull .env.local --scope howardseay-8349s-projects'
    );
    process.exit(1);
  }

  let state = {};
  try {
    state = JSON.parse(await readFile(STATE_PATH, 'utf8'));
  } catch {
    // No state file yet, so everything counts as changed.
  }

  let uploaded = 0;

  for (const doc of DOCS) {
    let html;
    try {
      html = await readFile(resolve(root, doc.source), 'utf8');
    } catch {
      console.error(`  missing  ${doc.source} — skipped`);
      continue;
    }

    const hash = digest(html);
    if (!force && state[doc.source] === hash) {
      console.log(`unchanged  ${doc.source}`);
      continue;
    }

    // allowOverwrite because the pathname is stable on purpose: the API looks
    // the document up by name, so a random suffix would strand it.
    await put(doc.pathname, html, {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'text/html; charset=utf-8',
    });

    state[doc.source] = hash;
    uploaded += 1;
    console.log(` uploaded  ${doc.source} -> ${doc.pathname} (${(html.length / 1024).toFixed(1)} KB)`);
  }

  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);

  if (uploaded === 0) console.log('\nNothing to upload.');
  else console.log(`\n${uploaded} document(s) published. No deploy needed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
