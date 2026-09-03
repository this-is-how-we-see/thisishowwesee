/**
 * Encrypts passcode-gated page content for public deployment.
 *
 * This repo is public, so gated content can never be committed as plaintext —
 * a passcode on the page would not hide it from GitHub. The plaintext lives in
 * private/ (gitignored); this script emits AES-GCM ciphertext to public/, which
 * is the only form that gets committed and deployed.
 *
 *   npm run encrypt            regenerate any payload whose source changed
 *   node scripts/encrypt-plan.mjs --quiet   same, but silent when nothing changed
 *
 * The pre-commit hook in .githooks/ runs this automatically, so an edit to a
 * source file can't be committed without its payload being rebuilt.
 *
 * Security note: the passcodes here are short, so the ciphertext is only as
 * strong as a brute-force search over the keyspace — a 4-digit code is 10,000
 * PBKDF2 evaluations for an attacker who downloads the JSON. The high iteration
 * count makes that cost real (hours, not seconds) but not prohibitive. This is
 * appropriate for keeping a draft private from casual discovery; it is not
 * appropriate for anything whose disclosure would actually harm someone.
 */

import { webcrypto as crypto, createHash } from "node:crypto";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PAGES = [
  {
    source: "private/health-advocates.src.html",
    output: "public/plan/health-advocates.json",
    passcode: "1321",
  },
];

const ITERATIONS = 600_000;

/**
 * Records a hash of each plaintext so repeat runs can tell "unchanged" from
 * "edited". It lives under private/ rather than beside the payload because a
 * hash published next to the ciphertext would let someone confirm a guess of
 * the document. Never key this digest with the passcode — an unstretched HMAC
 * would be far cheaper to brute-force than the PBKDF2 it is meant to protect.
 */
const STATE_PATH = resolve(root, "private/.build-state.json");

const quiet = process.argv.includes("--quiet");
const b64 = (buf) => Buffer.from(buf).toString("base64");
const exists = (path) => access(path).then(() => true, () => false);
const log = (message) => console.log(message);

async function encrypt(plaintext, passcode) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passcode),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );

  return {
    v: 1,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt: b64(salt) },
    iv: b64(iv),
    ct: b64(ciphertext),
  };
}

const state = await readFile(STATE_PATH, "utf8").then(JSON.parse, () => ({}));
let rebuilt = 0;

for (const page of PAGES) {
  let plaintext;
  try {
    plaintext = await readFile(resolve(root, page.source), "utf8");
  } catch {
    // Plaintext exists only on the author's machine. Absent anywhere else by
    // design, so this is a skip and not an error — it must not block a commit.
    if (!quiet) log(`skipped  ${page.source} — not on this machine`);
    continue;
  }

  const hash = createHash("sha256").update(plaintext).digest("hex");
  const outPath = resolve(root, page.output);

  if (state[page.source] === hash && (await exists(outPath))) {
    if (!quiet) log(`current  ${page.output}`);
    continue;
  }

  const payload = JSON.stringify(await encrypt(plaintext, page.passcode));
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, payload, "utf8");

  state[page.source] = hash;
  rebuilt += 1;
  log(`encrypted ${page.source} -> ${page.output} (${(payload.length / 1024).toFixed(1)} KB)`);
}

if (rebuilt > 0) {
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
