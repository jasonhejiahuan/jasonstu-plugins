#!/usr/bin/env python3
"""Build reproducible plugin and standalone skill ZIPs without local state."""
import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from validate_plugin import ROOT, SKILL, validate


def files(root):
    allowed = {'.md', '.py', '.txt', '.json', '.jsonl', '.yaml', '.ts', '.sql', '.svg'}
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root)
        if '__pycache__' in relative.parts or 'dist' in relative.parts or path.suffix == '.pyc':
            continue
        if path.is_symlink():
            raise ValueError(f'Symlink is not portable: {relative}')
        if path.is_file():
            if path.suffix not in allowed and path.name != 'LICENSE':
                raise ValueError(f'Unexpected package file: {relative}')
            yield path


def archive(root, output, prefix):
    with ZipFile(output, 'w', compression=ZIP_DEFLATED) as result:
        for path in files(root):
            info = ZipInfo(prefix+'/'+path.relative_to(root).as_posix(), date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            result.writestr(info, path.read_bytes())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    validate()
    output = args.out.resolve()
    if output.is_relative_to(ROOT) and output != ROOT/'dist':
        raise ValueError('Use the plugin dist directory or an output directory outside the package')
    output.mkdir(parents=True, exist_ok=True)
    version = json.loads((ROOT/'.codex-plugin/plugin.json').read_text(encoding='utf-8'))['version']
    paths = []
    for root, name in ((ROOT, 'ppq-question-curation'), (SKILL, 'exam-question-curation')):
        target = output/f'{name}-{version}.zip'
        archive(root, target, name)
        paths.append(target)
    checksum = ''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n' for p in paths)
    (output/'SHA256SUMS').write_text(checksum, encoding='utf-8')
    print(checksum, end='')


if __name__ == '__main__':
    main()
