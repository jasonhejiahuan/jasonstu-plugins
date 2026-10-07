#!/usr/bin/env python3
"""Give PPQ attachments readable source names without changing their bytes or IDs."""
import argparse
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import tempfile
import unicodedata
from zipfile import BadZipFile, ZipFile

NAMING_VERSION = 1
MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
SAFE_NAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.()+-]*')
RESERVED = re.compile(r'(?i)(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?')


def portable_name(value):
    """Keep official spelling, underscores and combined-paper '+' notation."""
    value = unicodedata.normalize('NFKD', str(value)).encode('ascii', 'ignore').decode()
    value = re.sub(r'[^A-Za-z0-9_.()+-]+', '-', value).strip(' .-')
    if RESERVED.fullmatch(value):
        value = 'source-' + value
    return value[:160].rstrip(' .-')


def readable_name(value):
    name = PurePosixPath(str(value).replace('\\', '/')).name
    if not SAFE_NAME.fullmatch(name) or RESERVED.fullmatch(name) or name.endswith('.') or len(name) > 180:
        return False
    stem = PurePosixPath(name).stem
    # Content hashes, UUIDs and prefixed transport IDs are not document names.
    meaningful = re.sub(r'(?i)(?<![a-z0-9])[0-9a-f]{6,}(?![a-z0-9])', '', stem)
    meaningful = re.sub(r'(?i)(?<![a-z0-9])(?:asset|pdf|figure|image|scan)(?![a-z0-9])', '', meaningful)
    opaque = re.sub(r'(?i)(?<![a-z0-9])(?:asset|pdf|figure|image|scan)(?![a-z0-9])', '', stem)
    if re.fullmatch(r'[0-9a-fA-F_.()-]+', opaque) and len(re.sub(r'[^0-9a-fA-F]', '', opaque)) >= 16:
        return False
    return bool(re.search(r'[A-Za-z]', meaningful))


def safe_path(path):
    if not isinstance(path, str) or '\\' in path or not path.startswith('assets/'):
        return False
    parts = path.split('/')
    return all(part not in ('', '.', '..') and SAFE_NAME.fullmatch(part) and not RESERVED.fullmatch(part)
               and not part.endswith('.') and len(part) <= 180 for part in parts)


def validate_asset_names(records):
    """New-package gate only; legacy platform imports need not apply this rule."""
    seen = set()
    for asset in records:
        if asset.get('type') != 'asset':
            continue
        path = asset.get('path')
        if not safe_path(path) or not readable_name(path):
            raise ValueError(f"Attachment {asset.get('id', '?')} needs a readable portable filename; run normalize_asset_names.py before signing")
        if path.casefold() in seen:
            raise ValueError(f'Duplicate attachment path: {path}')
        seen.add(path.casefold())


def source_tuple(source):
    """Only use confirmed source fields, never infer an exam date from a file date."""
    code, series, paper = (str(source.get(key, '')).strip() for key in ('code', 'series', 'paper'))
    if not code or not series or not paper:
        return None
    year = re.search(r'\b((?:19|20)\d{2})\b', series)
    if not year:
        return None
    season = re.sub(r'[^a-z]', '', series.lower())
    if str(source.get('board', '')).lower() in ('cie', 'cambridge', 'caie'):
        sessions = {'mayjune': 's', 'june': 's', 'octobernovember': 'w', 'octnov': 'w',
                    'november': 'w', 'februarymarch': 'm', 'febmarch': 'm', 'march': 'm'}
        session = sessions.get(season)
        session = session + year.group(1)[-2:] if session else portable_name(series).lower()
    else:
        session = portable_name(series).replace('-', '').lower()
    values = tuple(portable_name(value) for value in (code, session, paper))
    return values if all(values) else None


def source_bindings(records):
    bindings = {}
    for source in records:
        if source.get('type') != 'source':
            continue
        for role in ('qp', 'ms'):
            meta = source.get('meta') or {}
            ids = [source.get(role)] + (meta.get(role + 'DocumentAssets', []) if isinstance(meta, dict) else [])
            for asset_id in ids:
                if isinstance(asset_id, str):
                    bindings.setdefault(asset_id, []).append((source, role))
    for value in bindings.values():
        value.sort(key=lambda item: (str(item[0].get('id', '')), item[1]))
    return bindings



def diagram_occurrences(records, bindings, by_digest):
    sources = {item['id']: item for item in records if item.get('type') == 'source'}
    occurrences = {}
    for question in records:
        if question.get('type') != 'question':
            continue
        meta = question.get('meta') or {}
        diagrams = meta.get('diagrams', []) if isinstance(meta, dict) else []
        if not isinstance(diagrams, list):
            continue
        for diagram in diagrams:
            if not isinstance(diagram, dict) or not isinstance(diagram.get('assetId'), str):
                continue
            role = 'ms' if diagram.get('msPage') is not None else 'qp'
            page = diagram.get(role + 'Page')
            if not isinstance(page, int) or isinstance(page, bool) or page <= 0:
                continue
            parents = by_digest.get(str(diagram.get('pdfSha256', '')).lower(), [])
            links = [link for parent in parents for link in bindings.get(parent.get('id'), []) if link[1] == role]
            if not links:
                ids = question.get('source', [])
                ids = [ids] if isinstance(ids, str) else ids
                # The first source is the practice/marking source; do not assign
                # a secondary occurrence's page without its own source evidence.
                if ids and ids[0] in sources:
                    links = [(sources[ids[0]], role)]
            for source, role in links:
                if source_tuple(source):
                    occurrences.setdefault(diagram['assetId'], []).append((source, role, page))
    for values in occurrences.values():
        values.sort(key=lambda item: (str(item[0].get('id', '')), item[1], item[2]))
    return occurrences


def original_alias(asset, bindings):
    meta = asset.get('meta') or {}
    aliases = meta.get('sourceAliases', []) if isinstance(meta, dict) else []
    if isinstance(aliases, str):
        aliases = [aliases]
    names = set()
    for alias in aliases:
        if isinstance(alias, str):
            name = PurePosixPath(alias.replace('\\', '/')).name
            if readable_name(name):
                names.add(name)
    codes = [str(source.get('code', '')).casefold() for source, _role in bindings if source.get('code')]
    extension = PurePosixPath(str(asset.get('path', ''))).suffix.lower()
    names = [name for name in names if PurePosixPath(name).suffix.lower() == extension]
    return min(names, key=lambda name: (not any(code in name.casefold() for code in codes), len(name), name)) if names else None


def normalize_records(records, *, registry=None, invalidate_signature=False):
    """Return deep-copied records and every old→new asset path. No I/O.

    registry is an optional shared {path: sha256} dict across independently owned
    question banks. Call in a stable question-bank order; commit it only on success.
    IDs, bytes/digests, source/question records and unknown fields stay unchanged.
    """
    updated = deepcopy(records)
    assets = [item for item in updated if item.get('type') == 'asset']
    headers = [item for item in updated if item.get('type') == 'bank']
    if len(headers) != 1:
        raise ValueError('Exactly one question bank header is required')
    header = headers[0]
    bindings = source_bindings(updated)
    by_digest = {}
    for asset in assets:
        by_digest.setdefault(str(asset.get('sha256', '')).lower(), []).append(asset)
    occurrences = diagram_occurrences(updated, bindings, by_digest)
    shared = dict(registry or {})
    occupied = {path.casefold(): (path, digest.lower()) for path, digest in shared.items()}
    local = set()
    protected = {asset['path'].casefold(): asset.get('id') for asset in assets
                 if safe_path(asset.get('path')) and readable_name(asset['path'])}
    mapping = {}
    bank_name = portable_name(header.get('title') or 'question-bank').lower()
    if not readable_name(bank_name + '.pdf'):
        bank_name = 'question-bank'
    for ordinal, asset in enumerate(sorted(assets, key=lambda item: str(item.get('id', ''))), 1):
        old = asset.get('path')
        digest = str(asset.get('sha256', '')).lower()
        if not isinstance(old, str) or old in mapping or not re.fullmatch(r'[0-9a-f]{64}', digest):
            raise ValueError('Assets need distinct original paths and measured SHA-256 digests')
        extension = PurePosixPath(old).suffix.lower()
        if not re.fullmatch(r'\.[a-z0-9]{1,10}', extension):
            raise ValueError(f'Attachment has no usable file extension: {old}')
        links = bindings.get(asset.get('id'), [])
        alias = original_alias(asset, links)
        source = links[0] if links else None
        identity = source_tuple(source[0]) if source else None
        basis = 'existing-readable-name'
        if safe_path(old) and readable_name(old):
            candidate = old
        elif alias:
            candidate, basis = 'assets/' + alias, 'original-source-name'
        elif identity:
            code, session, paper = identity
            candidate, basis = f'assets/{code}_{session}_{source[1]}_{paper}{extension}', 'confirmed-source-fields'
        else:
            provenance = asset.get('provenance') or {}
            parent_hash = provenance.get('pdfSha256') if isinstance(provenance, dict) else None
            page = provenance.get('pdfPage') if isinstance(provenance, dict) else None
            parents = by_digest.get(str(parent_hash).lower(), [])
            parent = sorted(parents, key=lambda item: str(item.get('id', '')))[0] if parents else None
            parent_links = bindings.get(parent.get('id'), []) if parent else []
            parent_identity = source_tuple(parent_links[0][0]) if parent_links else None
            if parent_identity and isinstance(page, int) and not isinstance(page, bool) and page > 0:
                code, session, paper = parent_identity
                candidate = f'assets/figures/{code}_{session}_{paper}-{parent_links[0][1]}-{page}{extension}'
                basis = 'confirmed-parent-page'
            elif occurrences.get(asset.get('id')):
                occurrence, role, page = occurrences[asset['id']][0]
                code, session, paper = source_tuple(occurrence)
                candidate = f'assets/figures/{code}_{session}_{paper}-{role}-{page}{extension}'
                basis = 'confirmed-question-occurrence-page'
            else:
                candidate, basis = f'assets/{bank_name[:100]}-attachment-{ordinal:03d}{extension}', 'question-bank-title-ordinal'
        stem, suffix = str(PurePosixPath(candidate).with_suffix('')), PurePosixPath(candidate).suffix
        original_candidate = candidate
        counter = 0
        while (candidate.casefold() in local
               or (candidate.casefold() in protected and protected[candidate.casefold()] != asset.get('id'))
               or (candidate.casefold() in occupied and occupied[candidate.casefold()][1] != digest)):
            counter += 1
            candidate = f'{stem}-{digest[:10]}' + (f'-{counter}' if counter > 1 else '') + suffix
        # Reuse exact casing from an already published shared path with equal bytes.
        if candidate.casefold() in occupied:
            candidate = occupied[candidate.casefold()][0]
        local.add(candidate.casefold())
        occupied[candidate.casefold()] = (candidate, digest)
        shared[candidate] = digest
        mapping[old] = candidate
        if candidate != old:
            meta = asset.setdefault('meta', {})
            if not isinstance(meta, dict):
                raise ValueError(f'Cannot preserve non-object asset metadata: {asset.get("id")}')
            meta.setdefault('originalPath', old)
            if alias:
                meta.setdefault('sourceName', alias)
            naming = meta.setdefault('assetNaming', {})
            if not isinstance(naming, dict):
                raise ValueError('Cannot preserve non-object assetNaming metadata')
            naming.update(version=NAMING_VERSION, basis=basis)
            if candidate != original_candidate:
                naming['collisionOf'] = original_candidate
            asset['path'] = candidate
    if any(old != new for old, new in mapping.items()) and 'signature' in header:
        if not invalidate_signature:
            raise ValueError('Renaming changes signed content; explicitly pass --invalidate-signature and sign the new output again')
        meta = header.setdefault('meta', {})
        if not isinstance(meta, dict):
            raise ValueError('Cannot preserve non-object question bank metadata')
        history = meta.setdefault('invalidatedSignatures', [])
        if not isinstance(history, list):
            raise ValueError('Cannot preserve non-array invalidatedSignatures metadata')
        history.append({'reason': 'asset-paths-normalized', 'signature': header.pop('signature')})
    validate_asset_names(updated)
    if registry is not None:
        registry.update(shared)
    return updated, mapping


def parse_manifest(raw):
    def unique_keys(pairs):
        item = {}
        for key, value in pairs:
            if key in item:
                raise ValueError(f'Duplicate JSON key: {key}')
            item[key] = value
        return item
    return [json.loads(line, object_pairs_hook=unique_keys) for line in raw.decode('utf-8-sig').split('\n') if line.strip()]


def replace_changed_lines(raw, original, updated):
    """Untouched lines retain their exact bytes, spacing and CRLF/BOM."""
    bom = raw.startswith(b'\xef\xbb\xbf')
    lines = raw[3 if bom else 0:].decode('utf-8').split('\n')
    index = 0
    for position, line in enumerate(lines):
        if not line.strip():
            continue
        if original[index] != updated[index]:
            ending = '\r' if line.endswith('\r') else ''
            lines[position] = json.dumps(updated[index], ensure_ascii=False, separators=(',', ':')) + ending
        index += 1
    return (b'\xef\xbb\xbf' if bom else b'') + '\n'.join(lines).encode('utf-8')


def normalize_archive(source, output, *, invalidate_signature=False, check=False):
    """Write a separate complete archive; never overwrite original source material."""
    if not check and (output is None or output.exists() or source.resolve() == output.resolve()):
        raise ValueError('Choose a new output path; original resources are never overwritten')
    with ZipFile(source) as archive:
        names = [info.filename for info in archive.infolist()]
        if len(names) != len(set(names)) or sum(info.file_size for info in archive.infolist()) > MAX_ARCHIVE_BYTES:
            raise ValueError('Archive has duplicate names or exceeds 100 MiB expanded')
        raw = archive.read('bank.jsonl')
        records = parse_manifest(raw)
        assets = [record for record in records if record.get('type') == 'asset']
        for asset in assets:
            if hashlib.sha256(archive.read(asset['path'])).hexdigest() != str(asset['sha256']).lower():
                raise ValueError(f'Attachment digest mismatch: {asset.get("id")}')
        # Every shipped file must have a corresponding asset record.
        registered = {'bank.jsonl', *(asset['path'] for asset in assets)}
        if any(not info.is_dir() and info.filename not in registered for info in archive.infolist()):
            raise ValueError('Unregistered archive entries must be registered as assets before packaging')
        if check:
            validate_asset_names(records)
            return records, {asset['path']: asset['path'] for asset in assets}
        updated, mapping = normalize_records(records, invalidate_signature=invalidate_signature)
        output.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary_name = tempfile.mkstemp(prefix='.ppq-names-', dir=output.parent)
        os.close(fd)
        temporary = Path(temporary_name)
        try:
            with ZipFile(temporary, 'w') as target:
                for info in archive.infolist():
                    if info.is_dir():
                        continue
                    content = replace_changed_lines(raw, records, updated) if info.filename == 'bank.jsonl' else archive.read(info)
                    info.filename = mapping.get(info.filename, info.filename)
                    target.writestr(info, content)
            os.link(temporary, output)
        finally:
            temporary.unlink(missing_ok=True)
        return updated, mapping


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('question_bank', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--check', action='store_true', help='Validate without modifying anything')
    parser.add_argument('--invalidate-signature', action='store_true', help='Archive the prior signature; sign the renamed output again')
    args = parser.parse_args()
    source = args.question_bank.expanduser().resolve()
    output = args.output or source.with_name(source.name.removesuffix('.ppqbank.jstu') + '-named.ppqbank.jstu')
    try:
        _, mapping = normalize_archive(source, output.expanduser().resolve(), invalidate_signature=args.invalidate_signature, check=args.check)
        print(f'{len(mapping)} attachment names valid' if args.check else f'{sum(old != new for old, new in mapping.items())} attachments renamed: {output}')
        return 0
    except (ValueError, TypeError, KeyError, OSError, BadZipFile) as error:
        print(f'Question bank attachment naming failed: {error}', file=__import__('sys').stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
