/**
 * The one list of Google-gated documents, plus the publish-state helpers.
 *
 * This module exists because the list used to live in three places that drifted
 * apart: the publisher, the pre-commit hook, and api/private-doc.mjs. The hook's
 * copy silently fell a document behind, so an unpublished edit to it never
 * produced a warning. The publisher and the hook now share this file. The API
 * keeps its own table on purpose — it deploys to Vercel and must not reach into
 * scripts/ — but its table is slug -> pathname, so a mismatch there shows up
 * immediately as a 404 rather than as silence.
 *
 * The blob pathnames here MUST match the DOCS table in api/private-doc.mjs.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

export const DOCS = [
  { source: 'private/healthcare.src.html', pathname: 'private/healthcare.html' },
  { source: 'private/health-advocates.src.html', pathname: 'private/health-advocates.html' },
  { source: 'private/budget.src.html', pathname: 'private/budget.html' },
  { source: 'private/member.src.html', pathname: 'private/member.html' },
  { source: 'private/aab.src.html', pathname: 'private/aab.html' },
];

export const STATE_FILE = 'private/.publish-state.json';

export const digest = (text) => createHash('sha256').update(text).digest('hex');

/** Short, human-readable identity for whoever ran the publisher. */
export function actor() {
  const session = process.env.CLAUDE_CODE_SESSION_ID;
  if (session) return `claude:${session.slice(0, 8)}`;
  return `shell:${process.env.USER || 'unknown'}`;
}

/**
 * Reads the state file and normalises it.
 *
 * Version 1 was a flat map of source -> hash string. It could answer "has this
 * changed since the last upload" and nothing else, which is why a second
 * session could overwrite the first session's document without either of them
 * noticing. Version 2 records when each document was published, who published
 * it, and the last few hashes, so the publisher can tell three different things
 * apart: an ordinary edit, a revert to a version already superseded, and a peer
 * publishing underneath you.
 *
 * Migration is automatic and lossless: a v1 hash becomes the v2 `hash` with an
 * unknown time and author, and a one-entry history.
 */
export async function readState(statePath) {
  let raw = {};
  try {
    raw = JSON.parse(await readFile(statePath, 'utf8'));
  } catch {
    return { version: 2, docs: {} };
  }

  if (raw.version === 2 && raw.docs) return raw;

  const docs = {};
  for (const [source, value] of Object.entries(raw)) {
    if (typeof value !== 'string') continue;
    docs[source] = { hash: value, publishedAt: null, publishedBy: null, history: [value] };
  }
  return { version: 2, docs };
}

export async function writeState(statePath, state) {
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

/** The recorded hash for a source, whichever state version is on disk. */
export function recordedHash(state, source) {
  return state.docs?.[source]?.hash ?? null;
}
