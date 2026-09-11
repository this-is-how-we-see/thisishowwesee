/**
 * Publishes the passcode-free private documents to Vercel Blob.
 *
 *   npm run publish-private            upload any document whose source changed
 *   npm run publish-private -- --force   upload regardless, bypassing the guards
 *   npm run publish-private -- --dry-run run every check, change nothing
 *
 * This replaced scripts/encrypt-plan.mjs. Under that design the document was
 * committed to this repo as AES-GCM ciphertext, because the repo is public and
 * a passcode on the page hides nothing from GitHub. The ciphertext is gone: the
 * plaintext now goes to a PRIVATE blob, and api/private-doc.mjs hands it out
 * only after Google verifies the reader. Nothing about these documents is in
 * git any more, encrypted or otherwise.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SCRIPT REFUSES THINGS
 *
 * The blob pathname is stable and the upload sets allowOverwrite, so this
 * script will cheerfully replace a document with whatever happens to be on disk
 * at the moment it runs. Three ways that goes wrong, all observed or near-missed
 * on 2026-09-08 and 2026-09-11:
 *
 *   1. REVERT. Google Drive mirrors this folder and has rewritten a source file
 *      back to an older version between the edit and the publish. The publisher
 *      saw "changed" and shipped the stale copy, reporting success.
 *
 *   2. PEER. Two Claude sessions worked in this folder at once. private/ is
 *      gitignored, so git could not see the collision, and the state file is
 *      shared by both sessions, so a hash check could not see it either. The
 *      second session to publish would simply win, silently.
 *
 *   3. DRIFT. Anything published from another machine leaves this machine's
 *      record describing a document that is no longer what is live.
 *
 * So before overwriting anything, the publisher now checks that the document it
 * is about to replace is the one it last published, that the local copy is not
 * a version already superseded, and that nobody else published it recently. A
 * failed check stops that document and explains what to do. --force overrides
 * every check and says which ones it overrode.
 *
 * Needs BLOB_READ_WRITE_TOKEN. Get it with:
 *
 *   npx vercel env pull .env.local --scope howardseay-8349s-projects
 */

import { get, put } from '@vercel/blob';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOCS, STATE_FILE, digest, actor, readState, writeState,
} from './private-docs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_PATH = resolve(root, STATE_FILE);

/**
 * How recently another author's publish still counts as "they are working on
 * this right now." Two hours is long enough to cover a session that paused for
 * a meeting, and short enough that picking the document up again tomorrow does
 * not nag.
 */
const PEER_WINDOW_MS = 2 * 60 * 60 * 1000;

const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry-run');
const me = actor();

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

/**
 * The live document's hash, or null when nothing is published at that pathname.
 * useCache:false because a stale read here would defeat the whole check.
 */
async function publishedHash(pathname) {
  try {
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return digest(await new Response(result.stream).text());
  } catch {
    return null;
  }
}

function since(iso) {
  if (!iso) return 'an unknown time ago';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(mins)) return 'an unknown time ago';
  if (mins < 1) return 'less than a minute ago';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

/**
 * Returns a refusal string, or null when this document is safe to overwrite.
 * Order matters: the local-copy problem is reported before the remote one,
 * because a stale local copy is the thing the author can fix fastest.
 */
async function blockedReason(doc, localHash, record) {
  // 1. REVERT — the bytes on disk are a version this machine already published
  //    and then moved past. Publishing would undo the newer version.
  const history = record?.history ?? [];
  if (record && localHash !== record.hash && history.includes(localHash)) {
    return [
      'the local copy is an OLDER version that was already published and superseded',
      `    on disk: ${localHash.slice(0, 12)} (published earlier in this document's history)`,
      `    live:    ${record.hash.slice(0, 12)} (published ${since(record.publishedAt)})`,
      '    Something rewrote the file backwards. Recover the newer copy before publishing.',
    ].join('\n');
  }

  // 2. PEER — somebody else published this recently. The shared state file
  //    cannot distinguish their edit from yours, so ask rather than assume.
  if (
    record?.publishedBy && record.publishedBy !== me &&
    record.publishedAt && Date.now() - Date.parse(record.publishedAt) < PEER_WINDOW_MS
  ) {
    return [
      `${record.publishedBy} published this ${since(record.publishedAt)}`,
      `    You are ${me}. Their version is live and your file may not include it.`,
      '    Read the live document, merge their changes, then re-run with --force.',
    ].join('\n');
  }

  // 3. DRIFT — what is live is not what this machine last published.
  const live = await publishedHash(doc.pathname);
  if (record && live && live !== record.hash) {
    return [
      'the live document is not the one this machine last published',
      `    live:     ${live.slice(0, 12)}`,
      `    expected: ${record.hash.slice(0, 12)}`,
      '    It changed from somewhere else. Read it and merge before publishing.',
    ].join('\n');
  }
  if (!record && live) {
    return [
      'a document already exists at this blob pathname and this machine has no record of it',
      `    live: ${live.slice(0, 12)}`,
      '    Confirm you are not overwriting someone else, then re-run with --force.',
    ].join('\n');
  }

  return null;
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

  const state = await readState(STATE_PATH);
  let uploaded = 0;
  let blocked = 0;
  let overridden = 0;

  for (const doc of DOCS) {
    let html;
    try {
      html = await readFile(resolve(root, doc.source), 'utf8');
    } catch {
      console.error(`  missing  ${doc.source} — skipped`);
      continue;
    }

    const localHash = digest(html);
    const record = state.docs[doc.source];

    if (!force && record?.hash === localHash) {
      console.log(`unchanged  ${doc.source}`);
      continue;
    }

    const reason = await blockedReason(doc, localHash, record);
    if (reason && !force) {
      console.error(`\n  REFUSED  ${doc.source}\n    ${reason}\n`);
      blocked += 1;
      continue;
    }
    if (reason && force) {
      console.warn(`\n  FORCED   ${doc.source} — overriding a guard that fired:\n    ${reason}\n`);
      overridden += 1;
    }

    if (dryRun) {
      console.log(`  WOULD   ${doc.source} -> ${doc.pathname} (${(html.length / 1024).toFixed(1)} KB)`);
      uploaded += 1;
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

    const history = [...(record?.history ?? []), localHash].slice(-10);
    state.docs[doc.source] = {
      hash: localHash,
      publishedAt: new Date().toISOString(),
      publishedBy: me,
      history,
    };
    uploaded += 1;
    console.log(` uploaded  ${doc.source} -> ${doc.pathname} (${(html.length / 1024).toFixed(1)} KB)`);
  }

  if (!dryRun) await writeState(STATE_PATH, state);
  else console.log('\n  (--dry-run: nothing uploaded, state file untouched)');

  if (uploaded === 0 && blocked === 0) console.log('\nNothing to upload.');
  else if (dryRun && uploaded > 0) console.log(`\n${uploaded} document(s) would publish.`);
  else if (uploaded > 0 && !dryRun) console.log(`\n${uploaded} document(s) published. No deploy needed.`);
  if (overridden > 0) console.warn(`${overridden} guard(s) overridden by --force.`);
  if (blocked > 0) {
    console.error(`${blocked} document(s) REFUSED. Nothing was overwritten for those.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
