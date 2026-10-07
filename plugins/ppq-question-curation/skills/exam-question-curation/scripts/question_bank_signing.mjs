#!/usr/bin/env node
/** Dependency-free JavaScript canonicalization shared by the optional signing CLI. */
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function canonicalJson(value) {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

/** Keep PPQ's legacy aliases compatible without renaming unrelated extension keys. */
export function normalizeMarkSchemes(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalizeMarkSchemes);
  const aliases = value.type === 'question'
    ? { rubric: 'mark_scheme', rubricRaw: 'markSchemeRaw', authoredRubric: 'authoredMarkScheme' }
    : typeof value.part === 'string' && typeof value.marks === 'number'
      ? { rubricRaw: 'markSchemeRaw', authoredRubric: 'authoredMarkScheme' } : {};
  const entries = [];
  for (const [key, child] of Object.entries(value)) {
    const target = Object.hasOwn(aliases, key) ? aliases[key] : key;
    const next = normalizeMarkSchemes(child);
    if (target !== key && Object.hasOwn(value, target)) {
      if (canonicalJson(next) !== canonicalJson(normalizeMarkSchemes(value[target]))) throw new Error(`Conflicting legacy and canonical mark_scheme fields: ${target}`);
      continue;
    }
    entries.push([target, next]);
  }
  return Object.fromEntries(entries);
}

export function inspect(raw) {
  const lines = raw.replace(/^\uFEFF/, '').split('\n');
  const records = lines.filter(line => line.trim()).map(line => JSON.parse(line));
  if (records[0]?.type !== 'bank' || records.filter(record => record.type === 'bank').length !== 1) throw new Error('Exactly one question bank record must appear first.');
  const { signature: _signature, ...header } = records[0];
  const contentSha256 = createHash('sha256').update(canonicalJson(normalizeMarkSchemes([header, ...records.slice(1)])), 'utf8').digest('hex');
  const author = header.provenance?.creator;
  return { bankId: header.id, title: header.title, contentSha256, creator: author ? { name: author.name, model: author.model } : undefined };
}

export async function verify(signature, keys, expected) {
  const payload = signature?.payload;
  if (payload?.schema !== 'ppq-question-bank-signature/1' || payload.bankId !== expected.bankId || payload.contentSha256 !== expected.contentSha256 || canonicalJson(payload.creator) !== canonicalJson(expected.creator)) throw new Error('The returned signature does not match this question bank.');
  if (!payload.publisher?.id || !payload.publisher?.username || !payload.publisher?.displayName || !payload.issuedAt || !payload.keyId) throw new Error('The returned publisher signature is incomplete.');
  const entry = keys.find(entry => entry.keyId === payload.keyId);
  const publicKey = entry?.publicKey;
  if (!publicKey || publicKey.kty !== 'EC' || publicKey.crv !== 'P-256' || publicKey.d) throw new Error('The signature key is not a known public P-256 key.');
  const key = await webcrypto.subtle.importKey('jwk', publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(signature.value, 'base64url'), Buffer.from(canonicalJson(payload), 'utf8'));
  if (!valid) throw new Error('The platform signature could not be verified.');
}

export function attach(raw, signature) {
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : '';
  const lines = raw.slice(bom.length).split('\n');
  const index = lines.findIndex(line => line.trim());
  const ending = lines[index].endsWith('\r') ? '\r' : '';
  lines[index] = JSON.stringify({ ...JSON.parse(lines[index]), signature }) + ending;
  return bom + lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const input = readFileSync(0, 'utf8');
    if (process.argv[2] === 'inspect') process.stdout.write(JSON.stringify(inspect(input)));
    else if (process.argv[2] === 'attach') { const { raw, signature } = JSON.parse(input); process.stdout.write(attach(raw, signature)); }
    else if (process.argv[2] === 'verify') { const { signature, keys, expected } = JSON.parse(input); await verify(signature, keys, expected); process.stdout.write('verified'); }
    else throw new Error('Expected inspect, attach or verify.');
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
