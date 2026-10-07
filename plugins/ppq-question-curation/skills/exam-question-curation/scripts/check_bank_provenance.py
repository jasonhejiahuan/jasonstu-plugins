#!/usr/bin/env python3
"""Require creator, model and packaging provenance on a new PPQ deliverable."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import re
import sys
from zipfile import ZipFile, BadZipFile


def validate(header):
    if not isinstance(header, dict) or header.get('type') != 'bank':
        raise ValueError('The first record must be a bank')
    provenance = header.get('provenance')
    if not isinstance(provenance, dict) or type(provenance.get('version')) is not int or provenance['version'] != 1:
        raise ValueError('New packages require provenance.version: 1')
    if provenance.get('origin') not in ('first-party', 'third-party'):
        raise ValueError('provenance.origin must be first-party or third-party')
    if provenance.get('verification') not in ('unverified', 'source-verified'):
        raise ValueError('provenance.verification must be unverified or source-verified')
    for key in ('creator', 'packagedBy'):
        contributor = provenance.get(key)
        if not isinstance(contributor, dict) or not isinstance(contributor.get('name'), str) or not contributor['name'].strip():
            raise ValueError(f'provenance.{key}.name is required')
        if 'model' not in contributor or (contributor['model'] is not None and (not isinstance(contributor['model'], str) or not contributor['model'].strip())):
            raise ValueError(f'provenance.{key}.model must be the known model or null')
    timestamp = provenance.get('packagedAt')
    if not isinstance(timestamp, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})', timestamp):
        raise ValueError('provenance.packagedAt must be an ISO 8601 timestamp with a timezone')
    datetime.fromisoformat(timestamp.replace('Z', '+00:00'))


def check(path):
    path = Path(path)
    if path.name.lower().endswith('.ppqbank.jstu'):
        with ZipFile(path) as archive:
            if len([info for info in archive.infolist() if info.filename == 'bank.jsonl']) != 1:
                raise ValueError('The package must contain exactly one bank.jsonl')
            with archive.open('bank.jsonl') as stream:
                first = next((line for line in stream if line.decode('utf-8-sig').strip()), b'')
    else:
        with path.open('rb') as stream:
            first = next((line for line in stream if line.decode('utf-8-sig').strip()), b'')
    validate(json.loads(first.decode('utf-8-sig')))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bank', type=Path)
    args = parser.parse_args()
    try:
        check(args.bank)
    except (ValueError, TypeError, OSError, KeyError, BadZipFile) as error:
        print(f'Bank provenance check failed: {error}', file=sys.stderr)
        return 1
    print('Bank provenance is complete. Source accuracy still requires source review.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
