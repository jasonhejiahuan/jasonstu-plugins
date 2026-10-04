"""Synthetic, network-free behavioral tests for the portable curation helpers."""
import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

from common import digest, records
import check_metadata
import corpus
import study_table


def pdf(path, text):
    writer = PdfWriter()
    page = writer.add_blank_page(width=300, height=400)
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'),
                             NameObject('/Subtype'): NameObject('/Type1'),
                             NameObject('/BaseFont'): NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({
        NameObject('/F1'): writer._add_object(font)})})
    stream = DecodedStreamObject()
    safe = text.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
    stream.set_data(f'BT /F1 12 Tf 20 300 Td ({safe}) Tj ET'.encode('ascii'))
    page[NameObject('/Contents')] = writer._add_object(stream)
    writer.write(path)


def jsonl(path, items):
    Path(path).write_text(''.join(json.dumps(x, ensure_ascii=False) + '\n' for x in items), encoding='utf-8')


class CurationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest = self.root/'papers.jsonl'
        self.audit = self.root/'audit'
        self.occurrences = self.root/'occurrences.jsonl'
        self.groups = self.root/'groups.jsonl'
        self.out = self.root/'study'
        self.papers = []
        self.items = []
        for n in (1, 2):
            key = f'synthetic-{n}'
            qp, ms = self.root/f'{key}-qp.pdf', self.root/f'{key}-ms.pdf'
            pdf(qp, f'Synthetic component {n}: Define a widget.')
            pdf(ms, f'Synthetic marking scheme {n}: a named example object.')
            evidence = {kind+'Sha256': digest(path) for kind, path in (('qp', qp), ('ms', ms))}
            paper = {'id': key, 'board': 'illustrative', 'code': 'TEST', 'year': 2030,
                     'session': 'June', 'component': str(n),
                     'meta': {'unknown': [None, False, {'precise': '0.123456789012345678901'}]}}
            for kind, path in (('qp', qp), ('ms', ms)):
                paper[kind] = {'path': path.name, 'identityReview': {
                    'sha256': digest(path), 'reviewer': 'synthetic-fixture', 'reviewedAt': '2030-01-01'}}
            paper['screening'] = {'status': 'complete', 'qpSha256': digest(qp),
                                  'reviewer': 'synthetic-fixture', 'reviewedAt': '2030-01-01'}
            self.papers.append(paper)
            self.items.append({'id': key+'-q1', 'paperId': key, 'status': 'verified',
                               'part': '1(a)', 'marks': 1, 'question': 'Define a widget.',
                               'msRaw': f'Exact synthetic MS {n}.', 'answer': 'A named example object.',
                               'keywords': ['example object'], 'accept': [], 'doNotAccept': [],
                               'meta': {'keep': {'array': [False, None, '9007199254740993']}},
                               'evidence': {**evidence, 'qpPages': [1], 'msPages': [1],
                                            'visualChecked': True, 'reviewer': 'synthetic-fixture',
                                            'reviewedAt': '2030-01-01'}})
        self.write_inputs()

    def write_inputs(self):
        jsonl(self.manifest, self.papers)
        jsonl(self.occurrences, self.items)

    def audit_run(self):
        return corpus.run(self.manifest, self.audit)

    def render(self, groups=None):
        group_path = None
        if groups is not None:
            jsonl(self.groups, groups)
            group_path = self.groups
        return study_table.run(self.manifest, self.audit/'corpus.json', self.occurrences, group_path, self.out)

    def test_end_to_end_counts_source_links_and_exact_metadata_archive(self):
        report = self.audit_run()
        self.assertEqual(report['summary']['validPairs'], 2)
        self.assertEqual(report['summary']['identityCheckedPairs'], 2)
        self.assertEqual(report['summary']['candidateCount'], 2)
        initial_queue = (self.audit/'candidates.jsonl').read_bytes()
        self.audit_run()
        self.assertEqual(initial_queue, (self.audit/'candidates.jsonl').read_bytes())
        result = self.render([{'id': 'widgets', 'title': 'Define a widget', 'basis': 'Synthetic same answer',
                               'occurrenceIds': [i['id'] for i in self.items], 'future': {'keep': False}}])
        self.assertEqual(result['studyFamilies'][0]['occurrences'], 2)
        self.assertEqual(result['studyFamilies'][0]['papers'], 2)
        for name in ('papers.jsonl', 'occurrences.jsonl', 'groups.jsonl'):
            self.assertEqual((self.root/name).read_bytes(), (self.out/'source-records'/name).read_bytes())
        detail = (self.out/'occurrence-details.md').read_text()
        self.assertIn('../synthetic-1-qp.pdf#page=1', detail)
        self.assertIn('Exact synthetic MS 1.', detail)
        self.assertIn('Exact synthetic MS 2.', detail)

    def test_missing_or_html_ms_preserves_unmatched_candidate_and_returns_partial_exit(self):
        (self.root/'synthetic-1-ms.pdf').write_text('<html>challenge</html>')
        self.papers[1]['ms']['path'] = None
        self.write_inputs()
        report = self.audit_run()
        self.assertEqual(report['summary']['validFiles'], 2)
        self.assertEqual(report['summary']['validPairs'], 0)
        self.assertEqual([p['ms']['status'] for p in report['papers']], ['invalid', 'missing'])
        self.assertEqual(len(records(self.audit/'candidates.jsonl')), 2)
        self.assertTrue(all(not c['sameVariantMsAvailable'] for c in records(self.audit/'candidates.jsonl')))
        process = subprocess.run([sys.executable, str(Path(corpus.__file__)), '--manifest', str(self.manifest),
                                  '--out', str(self.audit)], capture_output=True)
        self.assertEqual(process.returncode, 2)

    def test_empty_text_and_unreviewed_cover_are_separate_from_valid_file(self):
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        writer.write(self.root/'synthetic-1-qp.pdf')
        report = self.audit_run()
        self.assertEqual(report['summary']['validFiles'], 4)
        self.assertEqual(report['summary']['pagesWithoutText'], 1)
        self.assertEqual(report['summary']['identityCheckedPairs'], 1)
        with self.assertRaisesRegex(ValueError, 'cover-identity'):
            self.render()

    def test_changed_pdf_and_changed_manifest_make_audit_stale(self):
        self.audit_run()
        pdf(self.root/'synthetic-1-qp.pdf', 'A different source revision')
        with self.assertRaisesRegex(ValueError, 'changed since'):
            self.render()
        self.papers[0]['meta']['new'] = True
        self.write_inputs()
        with self.assertRaisesRegex(ValueError, 'stale'):
            self.render()

    def test_wrong_pages_wrong_hash_or_unchecked_visual_are_rejected(self):
        self.audit_run()
        for field, value in [('msPages', [2]), ('qpSha256', '0'*64), ('visualChecked', False)]:
            with self.subTest(field=field):
                original = copy.deepcopy(self.items)
                self.items[0]['evidence'][field] = value
                jsonl(self.occurrences, self.items)
                with self.assertRaises(ValueError):
                    self.render()
                self.items = original

    def test_mirror_identity_does_not_inflate_manifest(self):
        mirror = copy.deepcopy(self.papers[0])
        mirror['id'] = 'mirror-name'
        self.papers.append(mirror)
        self.write_inputs()
        with self.assertRaisesRegex(ValueError, 'Duplicate paper identity'):
            self.audit_run()

    def test_duplicate_occurrences_and_group_double_count_rejected(self):
        self.audit_run()
        clone = copy.deepcopy(self.items[0])
        clone['id'] = 'duplicate'
        clone['part'] = '1 (a)'
        jsonl(self.occurrences, self.items+[clone])
        with self.assertRaisesRegex(ValueError, 'Repeated paper/subpart'):
            self.render()
        jsonl(self.occurrences, self.items)
        group = {'id': 'g', 'title': 'Widgets', 'basis': 'Test',
                 'occurrenceIds': [self.items[0]['id'], self.items[0]['id']]}
        with self.assertRaisesRegex(ValueError, 'more than once'):
            self.render([group])

    def test_pending_not_promoted_and_ungrouped_not_dropped(self):
        self.items.append({'id': 'pending', 'paperId': self.papers[0]['id'], 'status': 'candidate',
                           'question': 'Another eligible question requiring review'})
        self.items.append({'id': 'excluded', 'paperId': self.papers[0]['id'], 'status': 'excluded',
                           'reason': 'Outside requested response type'})
        self.write_inputs()
        self.audit_run()
        result = self.render()
        self.assertEqual(result['pendingOccurrences'], 1)
        self.assertEqual(result['excludedOccurrences'], 1)
        self.assertEqual(result['verifiedOccurrences'], 2)
        self.assertEqual(len(result['studyFamilies']), 2)
        with self.assertRaisesRegex(ValueError, 'unverified'):
            self.render([{'id': 'g', 'title': 'Wrong promotion', 'basis': 'Test', 'occurrenceIds': ['pending']}])


class MetadataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.before, self.after = self.root/'before.jsonl', self.root/'after.jsonl'
        self.record = {'type': 'question', 'id': 'q', 'rev': 1, 'source': ['primary', 'secondary'],
                       'sourceDetails': {'secondary': {'meta': {'a': [False, None, '9007199254740993']}}},
                       'rubric': {'future': {'preserve': True}}, 'modes': [{'unknown': ['a','b']}],
                       '__proto__': {'keep': True}, 'unknownRoot': {'precision': '0.123456789012345678901'}}
        jsonl(self.before, [self.record])

    def test_formatting_and_key_order_can_change(self):
        record = dict(reversed(list(self.record.items())))
        self.after.write_bytes(('\ufeff  '+json.dumps(record)+'\r\n').encode())
        self.assertEqual(check_metadata.compare(self.before, self.after), [])

    def test_recursive_unknown_loss_array_order_and_json_types_are_detected(self):
        for change in ('missing', 'order', 'type', 'source', 'root'):
            with self.subTest(change=change):
                item = copy.deepcopy(self.record)
                if change == 'missing': del item['sourceDetails']['secondary']['meta']
                if change == 'order': item['modes'][0]['unknown'].reverse()
                if change == 'type': item['rubric']['future']['preserve'] = 1
                if change == 'source': item['source'].reverse()
                if change == 'root': del item['unknownRoot']
                jsonl(self.after, [item])
                self.assertTrue(check_metadata.compare(self.before, self.after))

    def test_new_revision_requires_old_records_unchanged(self):
        new = copy.deepcopy(self.record)
        new['rev'] = 2
        new['newMetadata'] = {'reviewed': True}
        jsonl(self.after, [self.record, new])
        self.assertTrue(check_metadata.compare(self.before, self.after))
        self.assertEqual(check_metadata.compare(self.before, self.after, True), [])
        jsonl(self.after, [new])
        self.assertTrue(check_metadata.compare(self.before, self.after, True))

    def test_duplicate_keys_and_non_json_numbers_rejected(self):
        for raw in ('{"type":"question","id":"q","rev":1,"x":1,"x":2}',
                    '{"type":"question","id":"q","rev":1,"x":NaN}'):
            self.after.write_text(raw)
            with self.assertRaises(ValueError): check_metadata.compare(self.before, self.after)

    def test_decimal_precision_is_not_lost_in_comparison(self):
        self.before.write_text('{"type":"bank","id":"b","x":0.123456789012345678901}\n')
        self.after.write_text('{"type":"bank","id":"b","x":0.123456789012345678902}\n')
        self.assertTrue(check_metadata.compare(self.before, self.after))


if __name__ == '__main__':
    unittest.main()
