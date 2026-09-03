/**
 * Encrypts a passcode-gated page's content for public deployment.
 *
 * This repo is public, so gated content can never be committed as plaintext —
 * a passcode on the page would not hide it from GitHub. The plaintext lives in
 * private/ (gitignored); this script emits AES-GCM ciphertext to public/, which
 * is the only form that gets committed and deployed.
 *
 *   node scripts/encrypt-plan.mjs
 *
 * Re-run after every edit to a private/ source file.
 *
 * Security note: the passcodes here are short, so the ciphertext is only as
 * strong as a brute-force search over the keyspace — a 4-digit code is 10,000
 * PBKDF2 evaluations for an attacker who downloads the JSON. The high iteration
 * count makes that cost real (hours, not seconds) but not prohibitive. This is
 * appropriate for keeping a draft private from casual discovery; it is not
 * appropriate for anything whose disclosure would actually harm someone.
 */

import { webcrypto as crypto } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
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
const b64 = (buf) => Buffer.from(buf).toString("base64");

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

for (const page of PAGES) {
  const plaintext = await readFile(resolve(root, page.source), "utf8");
  const payload = await encrypt(plaintext, page.passcode);
  const outPath = resolve(root, page.output);

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(payload), "utf8");

  const kb = (JSON.stringify(payload).length / 1024).toFixed(1);
  console.log(`${page.source} -> ${page.output} (${kb} KB, passcode ${page.passcode.length} digits)`);
}
