#!/usr/bin/env python3
"""Audit an explicit QP/MS manifest and build an unverified page-level queue."""
import argparse
import hashlib
import json
import re
import sys
from importlib.metadata import version, PackageNotFoundError
from pathlib import Path

from common import (atomic_write, digest, is_review, manifest, read_json,
                    source_path, write_json)


COMMANDS = re.compile(
    r"\b(?:define|state\s+(?:what|why|how)|explain\s+(?:what|how|why)|"
    r"describe\s+(?:how|the)|identify|give\s+(?:the\s+)?definition)\b", re.I)


def inspect_source(manifest_path, source, output):
    import pypdf
    path = source_path(manifest_path, source)
    result = {"status": "missing", "identityChecked": False}
    if path is None or not path.is_file():
        return result, []
    sha = digest(path)
    result.update(sha256=sha, bytes=path.stat().st_size)
    try:
        with path.open("rb") as stream:
            if b"%PDF-" not in stream.read(1024):
                raise ValueError("Not a PDF signature (possibly an HTML response)")
        # Parse on every audit, even if extraction text is already cached.
        reader = pypdf.PdfReader(path)
        if reader.is_encrypted:
            raise ValueError("Encrypted PDF needs an authorized readable source")
        count = len(reader.pages)
        if not count:
            raise ValueError("PDF has no pages")
        try:
            fonttools_version = version("fonttools")
        except PackageNotFoundError:
            fonttools_version = "absent"
        extractor = f"pypdf-{pypdf.__version__}-fonttools-{fonttools_version}"
        cache = output / "text" / f"{sha}-{extractor}.json"
        pages = None
        if cache.is_file():
            try:
                saved = read_json(cache.read_text(encoding="utf-8"))
                if (saved.get("sha256") == sha and saved.get("extractor") == extractor
                        and len(saved.get("pages", [])) == count
                        and all(isinstance(p, str) for p in saved["pages"])):
                    pages = saved["pages"]
            except (ValueError, TypeError, AttributeError):
                pass
        if pages is None:
            pages = [page.extract_text() or "" for page in reader.pages]
            write_json(cache, {"sha256": sha, "extractor": extractor, "pages": pages})
        text_path = cache.with_suffix(".txt")
        atomic_write(text_path, "\n\n".join(
            f"===== PDF page {n} =====\n\n{text}" for n, text in enumerate(pages, 1)))
        result.update(status="valid", pages=count, text=str(text_path.relative_to(output)),
                      emptyTextPages=[n for n, p in enumerate(pages, 1) if not p.strip()],
                      identityChecked=is_review(source.get("identityReview"), sha))
        return result, pages
    except Exception as error:
        result.update(status="invalid", reason=f"{type(error).__name__}: {error}")
        return result, []


def run(manifest_path, output):
    manifest_path, output = Path(manifest_path).resolve(), Path(output).resolve()
    papers = manifest(manifest_path)
    if manifest_path == output / "corpus.json":
        raise ValueError("Output would replace the input manifest")
    rows, candidates, hashes = [], [], {}
    for paper in papers:
        row = {"id": paper["id"]}
        qp_pages = []
        for kind in ("qp", "ms"):
            info, pages = inspect_source(manifest_path, paper[kind], output)
            row[kind] = info
            if info["status"] == "valid":
                hashes.setdefault(info["sha256"], []).append(f"{paper['id']}:{kind}")
            if kind == "qp":
                qp_pages = pages
        row["validPair"] = all(row[k]["status"] == "valid" for k in ("qp", "ms"))
        screening = paper.get("screening", {})
        row["screened"] = bool(row["qp"]["status"] == "valid"
                                and isinstance(screening, dict)
                                and screening.get("status") == "complete"
                                and is_review(screening, row["qp"]["sha256"], "qpSha256"))
        rows.append(row)
        for number, text in enumerate(qp_pages, 1):
            # Search across line breaks; page/offset are navigation only, never a part ID.
            for match in COMMANDS.finditer(text):
                key = f"{paper['id']}:{row['qp']['sha256']}:{number}:{match.start()}"
                candidates.append({"id": "candidate-" + hashlib.sha256(key.encode()).hexdigest()[:20],
                                   "paperId": paper["id"], "qpPage": number,
                                   "offset": match.start(), "status": "candidate",
                                   "qpSha256": row["qp"]["sha256"],
                                   "sameVariantMsAvailable": row["ms"]["status"] == "valid",
                                   "excerpt": text[max(0, match.start()-80):match.end()+420]})
    files = [row[k] for row in rows for k in ("qp", "ms")]
    summary = {"expectedPairs": len(rows), "expectedFiles": len(files),
               "validFiles": sum(f["status"] == "valid" for f in files),
               "validPairs": sum(r["validPair"] for r in rows),
               "identityCheckedPairs": sum(r["validPair"] and all(r[k]["identityChecked"]
                                            for k in ("qp", "ms")) for r in rows),
               "screenedQuestionPapers": sum(r["screened"] for r in rows),
               "pagesWithoutText": sum(len(f.get("emptyTextPages", [])) for f in files),
               "candidateCount": len(candidates)}
    report = {"schema": "exam-corpus/1", "manifestSha256": digest(manifest_path),
              "summary": summary, "papers": rows,
              "duplicateFileBytes": [refs for refs in hashes.values() if len(refs) > 1]}
    write_json(output / "corpus.json", report)
    atomic_write(output / "candidates.jsonl", "".join(
        json.dumps(c, ensure_ascii=False) + "\n" for c in candidates))
    lines = ["# Corpus audit", "", *[f"- {k}: {v}" for k, v in summary.items()], "",
             "File validation, cover identity, screening and answer review are separate stages.", "",
             "| Paper | QP | MS | Covers checked | Screening |", "| --- | --- | --- | --- | --- |"]
    for row in rows:
        lines.append(f"| {row['id']} | {row['qp']['status']} | {row['ms']['status']} | "
                     f"{all(row[k]['identityChecked'] for k in ('qp', 'ms'))} | {row['screened']} |")
    atomic_write(output / "corpus.md", "\n".join(lines) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    try:
        report = run(args.manifest, args.out)
        print(json.dumps(report["summary"]))
        # A useful partial audit is still written; missing/invalid pairs are not success.
        return 0 if report["summary"]["validPairs"] == report["summary"]["expectedPairs"] else 2
    except (ValueError, OSError, ImportError) as error:
        print(f"Audit failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
