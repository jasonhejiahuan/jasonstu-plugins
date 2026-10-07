#!/usr/bin/env python3
"""Request an account-approved PPQ signature and save a separate signed question bank."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import build_opener, HTTPRedirectHandler, Request
import webbrowser
from zipfile import BadZipFile, ZipFile

from check_bank_provenance import validate
from normalize_asset_names import validate_asset_names

HELPER = Path(__file__).with_name('question_bank_signing.mjs')
MAX_MANIFEST_BYTES = 25 * 1024 * 1024
MAX_ARCHIVE_BYTES = 100 * 1024 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Signing requests cannot redirect to another endpoint')


def request(base, path, data=None):
    body = None if data is None else json.dumps(data, separators=(',', ':')).encode()
    response = build_opener(NoRedirect).open(Request(base + path, data=body, headers={'Content-Type': 'application/json', 'Accept': 'application/json', 'Origin': base}), timeout=20)
    with response:
        raw = response.read(256 * 1024 + 1)
    if len(raw) > 256 * 1024:
        raise ValueError('Signing response exceeded the size limit')
    return json.loads(raw)


def node(action, value):
    if not shutil.which('node'):
        raise ValueError('Node.js 22 or later is required for PPQ-compatible signing')
    data = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    result = subprocess.run(['node', str(HELPER), action], input=data.encode('utf-8'), capture_output=True)
    if result.returncode:
        raise ValueError(result.stderr.decode('utf-8').strip() or 'The signing helper failed')
    return result.stdout.decode('utf-8')


def reject_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f'Duplicate JSON key: {key}')
        result[key] = value
    return result


def read_manifest(source):
    if source.name.lower().endswith('.ppqbank.jstu'):
        with ZipFile(source) as archive:
            names = [info.filename for info in archive.infolist()]
            if len(names) != len(set(names)) or sum(info.file_size for info in archive.infolist()) > MAX_ARCHIVE_BYTES:
                raise ValueError('The archive has duplicate names or exceeds 100 MiB expanded')
            manifests = [info for info in archive.infolist() if info.filename == 'bank.jsonl']
            if len(manifests) != 1 or manifests[0].file_size > MAX_MANIFEST_BYTES:
                raise ValueError('The archive needs one bank.jsonl no larger than 25 MiB')
            raw = archive.read('bank.jsonl')
    else:
        if source.stat().st_size > MAX_MANIFEST_BYTES:
            raise ValueError('Question bank text exceeds 25 MiB')
        raw = source.read_bytes()
    text = raw.decode('utf-8-sig')
    records = [json.loads(line, object_pairs_hook=reject_duplicate_keys) for line in text.split('\n') if line.strip()]
    if not records:
        raise ValueError('The question bank is empty')
    validate(records[0])
    validate_asset_names(records)
    if source.name.lower().endswith('.ppqbank.jstu'):
        with ZipFile(source) as archive:
            registered = {'bank.jsonl', *(record['path'] for record in records if record.get('type') == 'asset')}
            if any(not info.is_dir() and info.filename not in registered for info in archive.infolist()):
                raise ValueError('Register all archive attachments and normalize their names before signing')
            for record in records:
                if record.get('type') == 'asset':
                    content = archive.read(record['path'])
                    if hashlib.sha256(content).hexdigest() != record['sha256'].lower():
                        raise ValueError(f"Attachment digest mismatch: {record['id']}")
    return raw.decode('utf-8')


def save_signed(source, output, raw, signature):
    if output.exists() or source.resolve() == output.resolve():
        raise ValueError('Choose a new output path; original resources are never overwritten')
    updated = node('attach', {'raw': raw, 'signature': signature}).encode('utf-8')
    if json.loads(node('inspect', updated.decode('utf-8'))) != json.loads(node('inspect', raw)):
        raise ValueError('Attaching the signature changed the signed content')
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.ppq-sign-', dir=output.parent)
    os.close(fd)
    temporary = Path(name)
    try:
        if source.name.lower().endswith('.ppqbank.jstu'):
            with ZipFile(source) as original, ZipFile(temporary, 'w') as target:
                for info in original.infolist():
                    target.writestr(info, updated if info.filename == 'bank.jsonl' else original.read(info))
        else:
            temporary.write_bytes(updated)
        # Exclusive publication also avoids replacing a concurrently created output.
        os.link(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)


def sign(source, output, base, timeout, open_browser=True):
    parsed = urlsplit(base)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise ValueError('Use only the platform origin, without credentials, path or query')
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1', '::1')):
        raise ValueError('Signing requires HTTPS (or a local development origin)')
    base = base.rstrip('/')
    if output.exists() or source.resolve() == output.resolve():
        raise ValueError('Choose a new output path; original resources are never overwritten')
    raw = read_manifest(source)
    expected = json.loads(node('inspect', raw))
    created = request(base, '/api/question-banks/signing/requests', expected)
    authorize = created['authorizeUrl']
    auth_url = urlsplit(authorize)
    if (auth_url.scheme, auth_url.netloc) != (parsed.scheme, parsed.netloc):
        raise ValueError('The account approval URL did not match the platform origin')
    expires = datetime.fromisoformat(created['expiresAt'].replace('Z', '+00:00'))
    if expires.tzinfo is None:
        raise ValueError('The signing request has an invalid expiration time')
    deadline = time.monotonic() + min(timeout, max(0, (expires - datetime.now(timezone.utc)).total_seconds()))
    print(f'Approve this question bank in your PPQ account: {authorize}', flush=True)
    if open_browser:
        webbrowser.open(authorize)
    result_path = f"/api/question-banks/signing/requests/{quote(created['requestId'], safe='')}/result"
    delay = 2
    while time.monotonic() < deadline:
        time.sleep(min(delay, max(0, deadline - time.monotonic())))
        try:
            result = request(base, result_path, {'pollToken': created['pollToken']})
        except HTTPError as error:
            if error.code in (429, 502, 503, 504):
                delay = min(delay * 2, 20)
                continue
            raise
        if result['status'] == 'pending':
            delay = min(delay + 1, 8)
            continue
        if result['status'] != 'signed':
            raise ValueError(f"Signing request ended: {result['status']}")
        signature = result['signature']
        keys = request(base, '/api/question-banks/signing/keys')['keys']
        node('verify', {'signature': signature, 'keys': keys, 'expected': expected})
        save_signed(source, output, raw, signature)
        print(f'Signed question bank saved: {output}')
        return
    raise ValueError('Account approval expired; the original question bank is unchanged')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('question_bank', type=Path)
    parser.add_argument('--base-url', default='https://ppq.beta.jasonstu.cc')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--timeout', type=int, default=600)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    source = args.question_bank.expanduser().resolve()
    suffix = '.ppqbank.jstu' if source.name.lower().endswith('.ppqbank.jstu') else '.jsonl'
    output = args.output or source.with_name(source.name.removesuffix(suffix) + '-signed' + suffix)
    try:
        if not 1 <= args.timeout <= 900:
            raise ValueError('Timeout must be between 1 and 900 seconds')
        sign(source, output.expanduser().resolve(), args.base_url, args.timeout, not args.no_browser)
        return 0
    except (ValueError, TypeError, KeyError, OSError, URLError, BadZipFile) as error:
        print(f'Question bank signing failed: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
