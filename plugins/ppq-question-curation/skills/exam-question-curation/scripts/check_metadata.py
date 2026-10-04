#!/usr/bin/env python3
"""Compare complete PPQ records after a round trip or append-only revision update."""
import argparse
import sys
from decimal import Decimal

from common import records


def index(path):
    result = {}
    for record in records(path, parse_float=Decimal):
        if not isinstance(record.get("type"), str) or not isinstance(record.get("id"), str):
            raise ValueError("Records need string type and id")
        key = (record["type"], record["id"], record.get("rev") if record["type"] == "question" else None)
        if key in result:
            raise ValueError(f"Duplicate record identity: {key}")
        result[key] = record
    return result


def difference(before, after, path="$"):
    numeric = (int, Decimal)
    if type(before) in numeric and type(after) in numeric:
        return None if before == after else path
    if type(before) is not type(after):
        return path
    if isinstance(before, dict):
        if before.keys() != after.keys():
            return path + ".{keys}"
        for key in before:
            mismatch = difference(before[key], after[key], path + "." + key)
            if mismatch:
                return mismatch
        return None
    if isinstance(before, list):
        if len(before) != len(after):
            return path + ".length"
        for i, (a, b) in enumerate(zip(before, after)):
            mismatch = difference(a, b, f"{path}[{i}]")
            if mismatch:
                return mismatch
        return None
    return None if before == after else path


def compare(before_path, after_path, allow_new_revisions=False):
    before, after = index(before_path), index(after_path)
    errors = []
    if not before:
        raise ValueError("No original records to compare")
    for key, record in before.items():
        if key not in after:
            errors.append(f"Missing original record: {key}")
        else:
            mismatch = difference(record, after[key])
            if mismatch:
                errors.append(f"Changed original {key} at {mismatch}")
    new_keys = after.keys() - before.keys()
    if new_keys and not allow_new_revisions:
        errors.append(f"Unexpected added records: {len(new_keys)}")
    if allow_new_revisions:
        for kind, key, rev in new_keys:
            if kind == "question":
                old = [r for t, i, r in before if t == kind and i == key]
                if type(rev) is not int or rev < 1 or (old and rev <= max(old)):
                    errors.append(f"Not a new question revision: {key}, {rev}")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before")
    parser.add_argument("after")
    parser.add_argument("--allow-new-revisions", action="store_true")
    args = parser.parse_args()
    try:
        errors = compare(args.before, args.after, args.allow_new_revisions)
        if errors:
            print("\n".join(errors), file=sys.stderr)
            return 1
        print("All original records and recursive metadata are unchanged.")
        return 0
    except (ValueError, TypeError, OSError) as error:
        print(f"Metadata check failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
