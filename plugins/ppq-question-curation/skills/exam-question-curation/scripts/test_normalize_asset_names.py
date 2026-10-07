"""Naming checks use actual teacher metadata shapes and small original bytes."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from normalize_asset_names import normalize_archive, normalize_records, parse_manifest, readable_name, validate_asset_names
from sign_question_bank import sign
from test_question_bank_signing import fixture


def asset(identifier, body, aliases=(), extension='pdf', **extra):
    return {'type':'asset', 'id':identifier, 'path':f'assets/{identifier}.{extension}',
            'mediaType':'application/pdf' if extension == 'pdf' else 'image/png',
            'sha256':hashlib.sha256(body).hexdigest(),
            'meta':{'sourceAliases':list(aliases), 'future':{'null':None, 'keep':False}}, **extra}


def source(identifier, pdf, code='0450', board='cie', series='May/June 2026', paper='11'):
    return {'type':'source','id':identifier,'board':board,'code':code,'series':series,'paper':paper,'qp':pdf,
            'meta':{'qpDocumentAssets':[pdf], 'future':['keep']}}


class AssetNameTests(unittest.TestCase):
    def test_preserves_official_cambridge_and_specific_edexcel_aliases(self):
        records = [fixture(),
            source('cambridge', 'pdf-'+'a'*24),
            source('edexcel', 'pdf-'+'b'*24, code='WAC12', board='edexcel', series='January 2023', paper='01'),
            asset('pdf-'+'a'*24, b'cambridge', ['papers/0450_s03_ms_1+2+4.pdf']),
            asset('pdf-'+'b'*24, b'edexcel', ['IAL_A2_JAN_23_QP.pdf', 'WAC12_01_0123_QU.pdf'])]
        original = deepcopy(records)
        updated, mapping = normalize_records(records)
        self.assertEqual(records, original)
        self.assertEqual(list(mapping.values()), ['assets/0450_s03_ms_1+2+4.pdf', 'assets/WAC12_01_0123_QU.pdf'])
        self.assertEqual(updated[1:3], records[1:3])
        self.assertEqual(updated[-1]['meta']['sourceName'], 'WAC12_01_0123_QU.pdf')
        self.assertEqual(updated[-1]['meta']['future'], {'null':None,'keep':False})
        self.assertEqual(normalize_records(updated)[0], updated)

    def test_opaque_alias_falls_back_to_confirmed_source_without_inventing_dates(self):
        records = [fixture(), source('cambridge', 'pdf-'+'c'*24),
                   asset('pdf-'+'c'*24,b'c',['f7b64c_c975fa9585fb4285a6d6c389bcb9547d.pdf']),
                   source('edexcel', 'pdf-'+'d'*24,code='4330',board='edexcel',series='November 2007',paper='03'),
                   asset('pdf-'+'d'*24,b'd',['4330_IGCSE_Business_msc_20080104.pdf'])]
        updated, mapping = normalize_records(records)
        self.assertEqual(list(mapping.values()), ['assets/0450_s26_qp_11.pdf','assets/4330_IGCSE_Business_msc_20080104.pdf'])
        self.assertNotIn('sourceName', updated[2]['meta'])

    def test_parent_and_reused_image_occurrences_keep_original_evidence(self):
        pdf = asset('pdf-'+'a'*24, b'pdf', ['0450_s26_qp_11.pdf'])
        image = asset('figure-'+'b'*24,b'image',extension='png',provenance={'pdfSha256':pdf['sha256'],'pdfPage':4,'unknown':['keep']})
        reused = asset('figure-'+'c'*24,b'reused',extension='png',provenance={'pdfSha256':'f'*64,'pdfPage':15})
        questions = [{'type':'question','id':'old','rev':1,'source':['paper-z','paper-a'],'meta':{'diagrams':[{'assetId':reused['id'],'qpPage':7,'pdfSha256':pdf['sha256']}]},'unknown':'history'},
                     {'type':'question','id':'old','rev':2,'source':'paper-a','meta':{'diagrams':[{'assetId':reused['id'],'qpPage':3}]}}]
        records = [fixture(),source('paper-z',pdf['id']),source('paper-a','other',series='October/November 2022',paper='12'),pdf,image,reused,*questions]
        updated, mapping = normalize_records(records)
        self.assertEqual(mapping[image['path']], 'assets/figures/0450_s26_11-qp-4.png')
        self.assertEqual(mapping[reused['path']], 'assets/figures/0450_w22_12-qp-3.png')
        self.assertEqual(updated[5]['provenance'], reused['provenance'])
        self.assertEqual(updated[-2:], questions)
        self.assertEqual(normalize_records(records[:-2]+list(reversed(questions)))[1], mapping)

    def test_collisions_are_case_insensitive_and_only_add_digest_when_needed(self):
        one = asset('pdf-'+'a'*24,b'one',['0450_s26_qp_11.pdf'])
        two = asset('pdf-'+'b'*24,b'two',['0450_s26_qp_11.pdf'])
        same = asset('pdf-'+'c'*24,b'one',['0450_s26_qp_11.pdf'])
        registry = {}
        _, first = normalize_records([fixture(),one],registry=registry)
        _, second = normalize_records([fixture(),two],registry=registry)
        _, repeat = normalize_records([fixture(),same],registry=registry)
        self.assertEqual(first[one['path']], 'assets/0450_s26_qp_11.pdf')
        self.assertEqual(second[two['path']], f"assets/0450_s26_qp_11-{two['sha256'][:10]}.pdf")
        self.assertEqual(repeat[same['path']], first[one['path']])
        within, mapping = normalize_records([fixture(),one,same])
        self.assertEqual(len(set(mapping.values())),2)
        self.assertEqual(normalize_records(within)[0],within)
        _, case = normalize_records([fixture(),asset('pdf-'+'d'*24,b'different',['0450_s26_QP_11.pdf'])],registry=registry)
        self.assertIn('-'+hashlib.sha256(b'different').hexdigest()[:10],next(iter(case.values())))

    def test_existing_readable_paths_keep_priority_over_generated_names(self):
        opaque = asset('pdf-'+'a'*24,b'new',['9702_s25_qp_21.pdf'])
        existing = {**asset('pdf-'+'z'*24,b'existing'),'path':'assets/9702_s25_qp_21.pdf'}
        updated, mapping = normalize_records([fixture(),opaque,existing])
        self.assertEqual(mapping[existing['path']], existing['path'])
        self.assertIn('-'+opaque['sha256'][:10],mapping[opaque['path']])
        self.assertEqual(updated[2],existing)
        self.assertEqual(normalize_records(updated)[0],updated)

    def test_unknown_source_uses_title_and_ordinal_without_fabricated_metadata(self):
        records = [fixture(),asset('pdf-'+'a'*24,b'unknown')]
        updated, mapping = normalize_records(records)
        self.assertEqual(next(iter(mapping.values())), 'assets/teacher-questions-attachment-001.pdf')
        self.assertNotIn('sourceName',updated[1]['meta'])
        self.assertEqual(updated[1]['meta']['originalPath'],records[1]['path'])

    def test_signed_rename_requires_explicit_invalidation_preserves_signature(self):
        header = fixture(); header['signature'] = {'payload':{'publisher':{'username':'original'}},'value':'old'}
        records = [header, asset('pdf-'+'a'*24,b'old',['9618_w22_ms_11.pdf'])]
        registry = {'assets/existing.pdf':'e'*64}; original_registry = dict(registry)
        with self.assertRaisesRegex(ValueError,'invalidate-signature'):
            normalize_records(records,registry=registry)
        self.assertEqual(registry,original_registry)
        updated, _ = normalize_records(records,invalidate_signature=True)
        self.assertNotIn('signature',updated[0])
        self.assertEqual(updated[0]['meta']['invalidatedSignatures'][0]['signature'],header['signature'])
        self.assertEqual(normalize_records(updated)[0],updated)
        unchanged = [header,{**records[1],'path':'assets/9618_w22_ms_11.pdf'}]
        self.assertEqual(normalize_records(unchanged)[0],unchanged)

    def test_complete_archive_keeps_bytes_history_bom_crlf_and_unicode_separators(self):
        with tempfile.TemporaryDirectory() as directory:
            original, output = Path(directory)/'original.ppqbank.jstu', Path(directory)/'named.ppqbank.jstu'
            body = b'%PDF-1.4\noriginal attachment bytes\n'
            pdf = asset('pdf-'+'a'*24,body,['9702_s25_qp_21.pdf'])
            unknown_question = '  {"type":"question","id":"history","rev":1,"stem":"a\u2028b\u2029c","unknown":{"exact":"9007199254740993"}}\r\n'
            raw = ('\ufeff'+json.dumps(fixture())+'\r\n'+unknown_question+json.dumps(pdf)+'\r\n').encode()
            with ZipFile(original,'w') as archive:
                archive.writestr('bank.jsonl',raw); archive.writestr(pdf['path'],body)
            original_bytes = original.read_bytes()
            records,mapping = normalize_archive(original,output)
            self.assertEqual(original.read_bytes(),original_bytes)
            with ZipFile(output) as archive:
                rewritten = archive.read('bank.jsonl')
                self.assertTrue(rewritten.startswith(b'\xef\xbb\xbf'))
                self.assertIn(unknown_question.encode(),rewritten)
                self.assertEqual(archive.read(mapping[pdf['path']]),body)
                self.assertEqual(parse_manifest(rewritten),records)
                self.assertNotIn(pdf['path'],archive.namelist())
            normalize_archive(output,None,check=True)
            with self.assertRaisesRegex(ValueError,'never overwritten'):
                normalize_archive(original,output)

    def test_validation_and_signing_reject_opaque_names_before_network(self):
        for name in ('assets/pdf-'+'a'*64+'.pdf','assets/f7b64c_c975fa9585fb4285a6d6c389bcb9547d.pdf','assets/../paper.pdf','assets/CON.pdf','assets/57ddc128-74e2-4a49-b8e1-9417dec7632f.pdf'):
            with self.subTest(name=name),self.assertRaises(ValueError):
                validate_asset_names([{'type':'asset','id':'test','path':name}])
        self.assertTrue(readable_name('0450_s03_ms_1+2+4.pdf'))
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory)/'input.jsonl'
            input_path.write_text('\n'.join(json.dumps(item) for item in [fixture(),asset('pdf-'+'a'*24,b'bytes')]))
            with patch('sign_question_bank.request') as request,self.assertRaisesRegex(ValueError,'normalize_asset_names'):
                sign(input_path,Path(directory)/'signed.jsonl','https://example.test',30)
            request.assert_not_called()

    def test_archive_rejects_missing_unregistered_and_modified_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            for case in ('unregistered','changed','missing'):
                original,output = Path(directory)/(case+'.ppqbank.jstu'),Path(directory)/(case+'-named.ppqbank.jstu')
                pdf=asset('pdf-'+'a'*24,b'original',['0450_s26_qp_11.pdf'])
                with ZipFile(original,'w') as archive:
                    archive.writestr('bank.jsonl','\n'.join(json.dumps(item) for item in [fixture(),pdf]))
                    if case != 'missing': archive.writestr(pdf['path'],b'changed' if case == 'changed' else b'original')
                    if case == 'unregistered': archive.writestr('unregistered.bin',b'keep')
                with self.subTest(case=case),self.assertRaises((ValueError,KeyError)):
                    normalize_archive(original,output)
                self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
