#!/usr/bin/env python3
"""Validate the portable package's metadata, paths and local references."""
import json
import re
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / 'skills/exam-question-curation'


def validate():
    plugin = json.loads((ROOT/'.codex-plugin/plugin.json').read_text(encoding='utf-8'))
    assert plugin['name'] == 'ppq-question-curation'
    assert re.fullmatch(r'\d+\.\d+\.\d+(?:\+[-\w.]+)?', plugin['version'])
    assert (ROOT/plugin['skills']).is_dir()
    assert 'mcpServers' not in plugin, 'This is a skill-only package'
    for key in ('composerIcon', 'logo'):
        assert (ROOT/plugin['interface'][key]).is_file(), key
    skill_text = (SKILL/'SKILL.md').read_text(encoding='utf-8')
    header = yaml.safe_load(skill_text.split('---', 2)[1])
    assert header['name'] == 'exam-question-curation'
    assert header['description'] and len(header['description']) <= 1024
    assert header['metadata']['version'] == plugin['version']
    interface = yaml.safe_load((SKILL/'agents/openai.yaml').read_text(encoding='utf-8'))['interface']
    assert '$exam-question-curation' in interface['default_prompt']
    for key in ('icon_small', 'icon_large'):
        assert (SKILL/interface[key]).is_file(), key
    assert (ROOT/'assets/ppq-logo.svg').read_bytes() == (SKILL/'assets/ppq-logo.svg').read_bytes()
    for path in ROOT.rglob('*.md'):
        if '__pycache__' in path.parts:
            continue
        text = path.read_text(encoding='utf-8')
        assert '[TODO:' not in text, path
        for target in re.findall(r'\[[^\]\n]*\]\(([^)\s]+)\)', text):
            if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target) or target.startswith('#'):
                continue
            resolved = (path.parent/target.split('#', 1)[0]).resolve()
            assert resolved.is_relative_to(ROOT), f'Reference escapes package: {path}: {target}'
            assert resolved.exists(), f'Missing reference: {path}: {target}'
    print(f"{plugin['name']} {plugin['version']}: metadata, icons and references valid")


if __name__ == '__main__':
    validate()
