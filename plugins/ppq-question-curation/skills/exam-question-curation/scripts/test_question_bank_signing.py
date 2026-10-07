"""Signing keeps source resources intact and verifies the publisher's actual signature."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from sign_question_bank import HELPER, node, read_manifest, request, sign


def fixture():
    return {'type': 'bank', 'schema': 'ppq-base/1', 'id': 'teacher', 'title': 'Teacher questions', 'language': 'en',
            'provenance': {'version': 1, 'origin': 'third-party', 'verification': 'unverified',
                           'creator': {'name': 'Carlos', 'model': None, 'unknown': {'keep': True}},
                           'packagedBy': {'name': 'Test agent', 'model': None}, 'packagedAt': '2026-10-07T00:00:00Z'},
            'unknown': {'fraction': 0.0000001, 'unicode': '😀', 'array': [None, False]}}


def signature_for(expected):
    script = '''
      import {webcrypto} from 'node:crypto';
      import {readFileSync} from 'node:fs';
      const {canonicalJson}=await import(process.argv[1]);
      const expected=JSON.parse(readFileSync(0,'utf8'));
      const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
      const payload={schema:'ppq-question-bank-signature/1',bankId:expected.bankId,contentSha256:expected.contentSha256,creator:expected.creator,publisher:{id:'user-1',username:'publisher',displayName:'Publisher'},issuedAt:'2026-10-07T00:00:00Z',keyId:'test-key'};
      const value=Buffer.from(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,Buffer.from(canonicalJson(payload)))).toString('base64url');
      process.stdout.write(JSON.stringify({signature:{payload,value},keys:[{keyId:'test-key',publicKey:await webcrypto.subtle.exportKey('jwk',pair.publicKey)}]}));
    '''
    result = subprocess.run(['node', '--input-type=module', '-e', script, HELPER.as_uri()], input=json.dumps(expected), text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


class SigningTests(unittest.TestCase):
    def test_http_request_supplies_the_selected_platform_origin(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_args): return False
            def read(self, _limit): return b'{"status":"pending"}'
        with patch('sign_question_bank.build_opener') as opener:
            opener.return_value.open.return_value = Response()
            self.assertEqual(request('https://example.test', '/api/question-banks/signing/requests', {'bankId':'q'}), {'status':'pending'})
            sent = opener.return_value.open.call_args.args[0]
            self.assertEqual(sent.get_header('Origin'), 'https://example.test')

    def test_shared_platform_fixture_and_legacy_alias_normalization(self):
        vector = json.loads((HELPER.parent/'fixtures/question-bank-signing.json').read_text(encoding='utf-8'))
        for key in ('raw', 'equivalentCanonicalRaw'):
            self.assertEqual(json.loads(node('inspect', vector[key]))['contentSha256'], vector['expectedSha256'])

    def test_digest_ignores_signature_but_binds_all_metadata_and_array_order(self):
        header = fixture()
        raw = json.dumps(header, ensure_ascii=False) + '\n'
        before = json.loads(node('inspect', raw))
        header['signature'] = {'untrusted': True}
        self.assertEqual(before, json.loads(node('inspect', json.dumps(header))))
        header['unknown']['array'].reverse()
        self.assertNotEqual(before['contentSha256'], json.loads(node('inspect', json.dumps(header)))['contentSha256'])
        self.assertEqual(before['creator'], {'name': 'Carlos', 'model': None})

    def test_rejects_modified_content_and_unknown_or_forged_signatures(self):
        expected = json.loads(node('inspect', json.dumps(fixture())))
        signed = signature_for(expected)
        node('verify', {**signed, 'expected': expected})
        with self.assertRaisesRegex(ValueError, 'known public'):
            node('verify', {**signed, 'keys': [], 'expected': expected})
        signed['signature']['payload']['publisher']['username'] = 'forged'
        with self.assertRaisesRegex(ValueError, 'could not be verified'):
            node('verify', {**signed, 'expected': expected})

    def test_account_flow_preserves_archive_assets_and_every_nonheader_line(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory)/'original.ppqbank.jstu', Path(directory)/'signed.ppqbank.jstu'
            suffix = '\r\n  {"type":"source","id":"example","future":[null,false]}\r\n'
            attachment = b'%PDF-1.4\noriginal attachment bytes\n'
            asset = {'type':'asset','id':'original','path':'assets/source.pdf','mediaType':'application/pdf','sha256':hashlib.sha256(attachment).hexdigest()}
            suffix += json.dumps(asset) + '\r\n'
            raw = '\ufeff' + json.dumps(fixture(), ensure_ascii=False) + suffix
            with ZipFile(source, 'w') as archive:
                archive.writestr('bank.jsonl', raw)
                archive.writestr('assets/source.pdf', attachment)
            original_bytes = source.read_bytes()
            expected = json.loads(node('inspect', raw))
            signed = signature_for(expected)
            create = {'requestId': 'request-1', 'pollToken': 'opaque-poll-token', 'authorizeUrl': 'https://example.test/?sign_question_bank=request-1', 'expiresAt': '2099-01-01T00:00:00Z'}
            with patch('sign_question_bank.request', side_effect=[create, {'status': 'signed', 'signature': signed['signature']}, {'keys': signed['keys']}]) as api, patch('sign_question_bank.time.sleep'), patch('sign_question_bank.webbrowser.open') as browser:
                sign(source, output, 'https://example.test', 30)
                self.assertEqual(api.call_args_list[0].args[2], expected)
                self.assertEqual(api.call_args_list[1].args[2], {'pollToken': 'opaque-poll-token'})
                browser.assert_called_once_with(create['authorizeUrl'])
            self.assertEqual(source.read_bytes(), original_bytes)
            with ZipFile(output) as archive:
                self.assertEqual(archive.read('assets/source.pdf'), attachment)
                self.assertTrue(archive.read('bank.jsonl').decode('utf-8').endswith(suffix))
            self.assertEqual(json.loads(node('inspect', read_manifest(output))), expected)

    def test_rejects_duplicate_json_keys_and_cross_origin_approval(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)/'input.jsonl'
            source.write_text('{"type":"bank","type":"source"}\n')
            with self.assertRaisesRegex(ValueError, 'Duplicate JSON key'):
                read_manifest(source)
            source.write_text(json.dumps(fixture()))
            create = {'authorizeUrl': 'https://other.test/steal'}
            with patch('sign_question_bank.request', return_value=create), self.assertRaisesRegex(ValueError, 'did not match'):
                sign(source, Path(directory)/'out.jsonl', 'https://example.test', 30)


if __name__ == '__main__':
    unittest.main()
