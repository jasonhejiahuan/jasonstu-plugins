"""New-package requirements remain separate from PPQ legacy import compatibility."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from check_bank_provenance import check, validate


def fixture():
    return {'type': 'bank', 'provenance': {'version': 1, 'origin': 'third-party', 'verification': 'unverified',
            'creator': {'name': 'Original author', 'model': None, 'unknown': [False, None]},
            'packagedBy': {'name': 'Packaging agent', 'model': 'Declared model'},
            'packagedAt': '2026-10-07T10:00:00Z', 'future': {'kept': True}}}


class ProvenanceTests(unittest.TestCase):
    def test_accepts_unknown_model_without_mutation(self):
        bank = fixture()
        before = copy.deepcopy(bank)
        validate(bank)
        self.assertEqual(before, bank)
        self.assertIsNone(bank['provenance']['creator']['model'])

    def test_missing_metadata_or_model_requires_explicit_completion(self):
        with self.assertRaises(ValueError):
            validate({'type': 'bank', 'author': 'Someone'})
        bank = fixture()
        del bank['provenance']['creator']['model']
        with self.assertRaisesRegex(ValueError, 'creator.model'):
            validate(bank)

    def test_rejects_empty_credit_invalid_status_and_timestamp(self):
        for key, value in [('origin', 'official'), ('verification', 'format-valid'), ('packagedAt', 'yesterday')]:
            bank = fixture()
            bank['provenance'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate(bank)
        bank = fixture()
        bank['provenance']['creator']['name'] = ' '
        with self.assertRaisesRegex(ValueError, 'creator.name'):
            validate(bank)

    def test_reads_complete_archive_and_jsonl_with_bom(self):
        with tempfile.TemporaryDirectory() as root:
            raw = '\ufeff\r\n' + json.dumps(fixture()) + '\r\n'
            text = Path(root)/'bank.jsonl'
            text.write_text(raw, encoding='utf-8')
            check(text)
            package = Path(root)/'bank.ppqbank.jstu'
            with ZipFile(package, 'w') as archive:
                archive.writestr('bank.jsonl', raw)
            check(package)


if __name__ == '__main__':
    unittest.main()
