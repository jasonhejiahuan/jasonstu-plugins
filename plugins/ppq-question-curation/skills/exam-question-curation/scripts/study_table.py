#!/usr/bin/env python3
"""Validate reviewed occurrence evidence and render a reproducible study table."""
import argparse
import html
import json
import os
import sys
from pathlib import Path
from urllib.parse import quote

from common import (atomic_write, digest, identifier, manifest, read_json,
                    records, source_path, write_json)


def cell(value):
    return html.escape(str(value), quote=False).replace("|", "\\|").replace("\n", "<br>")


def validate_occurrence(item, papers, audit):
    key = identifier(item.get("id"))
    status = item.get("status")
    if status not in ("candidate", "verified", "excluded"):
        raise ValueError(f"{key}: unknown review status")
    if item.get("paperId") not in papers:
        raise ValueError(f"{key}: unknown paper")
    if status == "excluded" and not item.get("reason"):
        raise ValueError(f"{key}: exclusion needs a reason")
    if status != "verified":
        return
    for field in ("part", "question", "msRaw", "answer"):
        if not isinstance(item.get(field), str) or not item[field].strip():
            raise ValueError(f"{key}: verified occurrence needs {field}")
    if type(item.get("marks")) is not int or item["marks"] < 1:
        raise ValueError(f"{key}: original marks must be a positive integer")
    for field in ("keywords", "accept", "doNotAccept"):
        if not isinstance(item.get(field), list) or any(not isinstance(v, str) for v in item[field]):
            raise ValueError(f"{key}: {field} must be an explicitly reviewed string array")
    if item.get("chapter") and not item.get("syllabus"):
        raise ValueError(f"{key}: chapter needs its syllabus edition/reference")
    evidence = item.get("evidence", {})
    if (not isinstance(evidence, dict) or evidence.get("visualChecked") is not True
            or not all(isinstance(evidence.get(k), str) and evidence[k].strip()
                       for k in ("reviewer", "reviewedAt"))):
        raise ValueError(f"{key}: visual review attribution is missing")
    paper_audit = audit[item["paperId"]]
    for kind in ("qp", "ms"):
        source = paper_audit[kind]
        if source["status"] != "valid" or not source.get("identityChecked"):
            raise ValueError(f"{key}: {kind} must be valid and cover-identity reviewed")
        if evidence.get(f"{kind}Sha256") != source["sha256"]:
            raise ValueError(f"{key}: {kind} review refers to different bytes")
        pages = evidence.get(f"{kind}Pages")
        if (not isinstance(pages, list) or not pages or len(set(map(str, pages))) != len(pages)
                or any(type(p) is not int or not 1 <= p <= source["pages"] for p in pages)):
            raise ValueError(f"{key}: invalid {kind} page references")


def run(manifest_path, audit_path, occurrences_path, groups_path, output):
    manifest_path, output = Path(manifest_path).resolve(), Path(output).resolve()
    papers = {p["id"]: p for p in manifest(manifest_path)}
    report = read_json(Path(audit_path).read_text(encoding="utf-8"))
    if report.get("schema") != "exam-corpus/1" or report.get("manifestSha256") != digest(manifest_path):
        raise ValueError("Corpus audit is stale; rerun it with this manifest")
    audited = {p["id"]: p for p in report["papers"]}
    if set(audited) != set(papers):
        raise ValueError("Corpus audit does not cover this manifest")
    # Recheck bytes once per component; a cached audit is not authority for changed PDFs.
    for key, paper in papers.items():
        for kind in ("qp", "ms"):
            info = audited[key][kind]
            if info["status"] == "valid":
                path = source_path(manifest_path, paper[kind])
                if path is None or not path.is_file() or digest(path) != info["sha256"]:
                    raise ValueError(f"{key}: {kind} changed since the audit")
    items = records(occurrences_path)
    by_id, seen = {}, set()
    for item in items:
        validate_occurrence(item, papers, audited)
        key = item["id"]
        if key in by_id:
            raise ValueError(f"Duplicate occurrence ID: {key}")
        by_id[key] = item
        if item["status"] == "verified":
            identity = (item["paperId"], "".join(item["part"].lower().split()))
            if identity in seen:
                raise ValueError(f"Repeated paper/subpart occurrence: {identity}")
            seen.add(identity)
    verified = {k: v for k, v in by_id.items() if v["status"] == "verified"}
    groups = records(groups_path) if groups_path else []
    assigned, group_ids = set(), set()
    for group in groups:
        key = identifier(group.get("id"))
        if key in group_ids:
            raise ValueError(f"Duplicate group ID: {key}")
        group_ids.add(key)
        for field in ("title", "basis"):
            if not isinstance(group.get(field), str) or not group[field].strip():
                raise ValueError(f"{key}: grouping needs {field}")
        ids = group.get("occurrenceIds")
        if not isinstance(ids, list) or not ids or not all(isinstance(i, str) for i in ids):
            raise ValueError(f"{key}: missing occurrence IDs")
        for occurrence_id in ids:
            if occurrence_id not in verified:
                raise ValueError(f"{key}: unknown or unverified occurrence {occurrence_id}")
            if occurrence_id in assigned:
                raise ValueError(f"Occurrence counted more than once: {occurrence_id}")
            assigned.add(occurrence_id)
    # Ungrouped verified originals remain visible instead of being silently dropped.
    for key, item in verified.items():
        if key not in assigned:
            group_id = f"occurrence-{key}"
            if group_id in group_ids:
                raise ValueError(f"Group ID collides with an ungrouped occurrence: {group_id}")
            groups.append({"id": group_id, "title": item["question"],
                           "basis": "Single reviewed occurrence", "occurrenceIds": [key]})
    groups.sort(key=lambda g: (-len(g["occurrenceIds"]), g["id"]))

    def source_links(item):
        paper = papers[item["paperId"]]
        links = []
        for kind in ("qp", "ms"):
            path = source_path(manifest_path, paper[kind])
            relative = quote(os.path.relpath(path, output).replace(os.sep, "/"), safe="/")
            for page in item["evidence"][f"{kind}Pages"]:
                links.append(f"[{kind.upper()} p.{page}]({relative}#page={page})")
        return f"{cell(item['paperId'])} {cell(item['part'])}: " + ", ".join(links)

    details = ["# Reviewed occurrences", "", "Study answers and exact MS text remain separate.", ""]
    for item in verified.values():
        details.extend([f"<a id=\"{item['id']}\"></a>", f"## {cell(item['id'])}", "",
                        source_links(item), "", f"**Question ({item['marks']} marks)**", "",
                        cell(item['question']), "", "**Exact mark scheme**", "", cell(item['msRaw']), "",
                        "**Study answer**", "", cell(item['answer']), "",
                        "**Keywords:** " + cell("; ".join(item['keywords'])), "",
                        "**Accept:** " + cell("; ".join(item['accept']) or "Not stated in this MS"), "",
                        "**Do not accept:** " + cell("; ".join(item['doNotAccept']) or "Not stated in this MS"), ""])
    table = ["# Verified study table", "", "Frequency counts reviewed occurrences within the declared corpus; unresolved evidence is excluded.", "",
             "| Question | Answer | Keywords / Accept | Do not accept | Chapter | Frequency | Sources |",
             "| --- | --- | --- | --- | --- | ---: | --- |"]
    counts = []
    for group in groups:
        members = [verified[key] for key in group["occurrenceIds"]]
        def variants(field):
            values = [(m["id"], m.get(field)) for m in members]
            def display(v):
                if isinstance(v, list):
                    return cell("; ".join(v) or ("Not stated in this MS" if field in ("accept", "doNotAccept") else "None recorded"))
                return cell(v or "Unclassified")
            if all(v == values[0][1] for _, v in values):
                return display(values[0][1])
            return "<br>".join(f"[{key}](occurrence-details.md#{key}): {display(v)}" for key, v in values)
        answer = variants("answer")
        keywords = variants("keywords")
        if any(m["accept"] for m in members):
            keywords += "<br>Accept: " + variants("accept")
        reject = variants("doNotAccept") if any(m["doNotAccept"] for m in members) else "Not stated in these MS"
        links = "<br>".join(f"[{m['id']}](occurrence-details.md#{m['id']}) — {source_links(m)}" for m in members)
        frequency = len(members)
        counts.append({"id": group["id"], "occurrences": frequency,
                       "papers": len({m["paperId"] for m in members}), "occurrenceIds": group["occurrenceIds"]})
        table.append(f"| {cell(group['title'])} | {answer} | {keywords} | {reject} | {variants('chapter')} | {frequency} | {links} |")
    summary = {"corpus": report["summary"], "verifiedOccurrences": len(verified),
               "pendingOccurrences": sum(i["status"] == "candidate" for i in items),
               "excludedOccurrences": sum(i["status"] == "excluded" for i in items),
               "studyFamilies": counts,
               "completeness": "Not inferred: confirm whole-paper screening and resolve every eligible occurrence."}
    # Preserve every unknown field, key, JSON type and original byte, not just table columns.
    for name, path in (("papers.jsonl", manifest_path), ("occurrences.jsonl", occurrences_path),
                       ("groups.jsonl", groups_path), ("corpus.json", audit_path)):
        if path:
            atomic_write(output / "source-records" / name, Path(path).read_bytes())
    write_json(output / "summary.json", summary)
    atomic_write(output / "occurrence-details.md", "\n".join(details) + "\n")
    atomic_write(output / "table.md", "\n".join(table) + "\n")
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ("manifest", "audit", "occurrences", "out"):
        parser.add_argument(f"--{field}", required=True, type=Path)
    parser.add_argument("--groups", type=Path)
    args = parser.parse_args()
    try:
        result = run(args.manifest, args.audit, args.occurrences, args.groups, args.out)
        print(json.dumps({k: v for k, v in result.items() if k != "studyFamilies"}))
        return 0
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(f"Study table failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
