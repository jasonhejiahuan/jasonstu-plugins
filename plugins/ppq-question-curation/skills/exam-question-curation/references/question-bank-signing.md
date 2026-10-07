# Account-approved question bank signing

After validating a newly prepared PPQ package and its [creator/model provenance](ppq.md#bank-provenance), request the canonical publisher signature with the bundled helper. Normal curation stays usable without account access; signing needs an approving account with **Publish canonical question banks** permission. Use the user's target platform origin, defaulting to the configured beta below. The helper only sends bank ID, title, content hash and declared creator to the service; it does not upload question text, assets, answers or account cookies.

```sh
python3 SKILL_DIR/scripts/check_bank_provenance.py questions.ppqbank.jstu
python3 SKILL_DIR/scripts/sign_question_bank.py questions.ppqbank.jstu
```

Python 3.10+ and Node.js 22+ are required for signing; there are no npm packages. Node performs the exact JavaScript number serialization used by PPQ. Python handles portable archive files and the approval flow. Do not replace the canonical digest with Python's ordinary `json.dumps`: exponent and number formatting can differ.

The command opens an account approval page once, using the existing browser session. The user signs in if needed and approves the identified question bank. The command polls at a bounded interval and writes `questions-signed.ppqbank.jstu` only after the returned signature matches the request and verifies against the platform public key. It never asks for credentials, reads browser cookies or stores a private signing key. Unknown models remain `null`. Permission failure, rejection or expiration leaves the original file unchanged; report the unsigned result and pending signing status without claiming Canonical.

Options: `--base-url https://ppq.beta.jasonstu.cc`, `--output new-file.ppqbank.jstu`, `--no-browser` (show the approval link without opening it), and `--timeout 600`. A `.jsonl` input is also supported. Output must be a new path. HTTPS is required except for a loopback development origin. Approvals must stay on the supplied platform origin; redirects are rejected. The polling token stays in memory and must not be printed, logged, placed in a browser URL or committed.

## What is signed

The bank header gains `signature:{payload,value}`. The payload uses `schema:"ppq-question-bank-signature/1"`, `bankId`, `contentSha256`, `creator:{name,model}`, `publisher:{id,username,displayName}`, `issuedAt` and `keyId`. `publisher` is the account that approved publication; it must not replace the original `creator`. The base64url `value` is an ECDSA P-256/SHA-256 signature of the canonical payload JSON. Source origin and actual verification status remain separate. A signed teacher resource can still be third-party and unverified.

The content hash is SHA-256 of UTF-8 canonical JSON for all complete records, in their original array order, with only the bank-header `signature` omitted. Before hashing, apply PPQ's scoped legacy aliases: question objects map `rubric` → `mark_scheme`, `rubricRaw` → `markSchemeRaw`, and `authoredRubric` → `authoredMarkScheme`; source-occurrence objects with string `part` and numeric `marks` map the latter two. Recurse without renaming unrelated extension keys. Equal dual fields collapse; conflicting values fail. Object keys use JavaScript sorted-key `JSON.stringify`; array order, text, source metadata, scoring, creator and attachment SHA-256 fields all remain bound. This allows an ordinary legacy import/export to preserve its signature. Changed questions, assets, metadata or author information require a new signature.

The platform pins public verification keys. A claimed signature or a `first-party` metadata field is never sufficient to display Canonical. The helper additionally verifies against the public keys returned by the selected HTTPS platform before writing output. Actual import must still validate schema, attachment digests and source fidelity boundaries. It is not permission to mark original exam content reviewed.

## Service contract

- `POST /api/question-banks/signing/requests` with `{bankId,title,contentSha256,creator}` returns `{requestId,pollToken,authorizeUrl,expiresAt}`.
- The browser opens `/?sign_question_bank=<requestId>`, reads the request with its normal account, and uses the authenticated approval action. The agent does not supply a publisher username.
- `POST /api/question-banks/signing/requests/:id/result` with `{pollToken}` returns `pending` or `signed` with `signature`.
- `GET /api/question-banks/signing/keys` returns `{keys:[{keyId,publicKey:JWK}]}` containing public P-256 keys only.

The helper preserves original files and attachment bytes, verifies registered archive assets, and changes only the header in the new output. Source validation and package completion precede account approval. Rerun the real PPQ importer and signature verification on the final file. The shared canonical fixture in `scripts/fixtures/question-bank-signing.json` is also exercised by the platform tests.
