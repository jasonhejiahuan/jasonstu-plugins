"""Small, lossless-input helpers shared by the curation commands."""
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def invalid_constant(value):
    raise ValueError(f"Non-JSON number: {value}")


def read_json(text, **kwargs):
    return json.loads(text, object_pairs_hook=unique_object,
                      parse_constant=invalid_constant, **kwargs)


def records(path, **kwargs):
    result = []
    for line, text in enumerate(Path(path).read_text(encoding="utf-8-sig").splitlines(), 1):
        if not text.strip():
            continue
        try:
            value = read_json(text, **kwargs)
            if not isinstance(value, dict):
                raise ValueError("Expected an object")
            result.append(value)
        except ValueError as error:
            raise ValueError(f"{Path(path).name}:{line}: {error}") from error
    return result


def digest(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def atomic_write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = value.encode("utf-8") if isinstance(value, str) else value
    handle, temporary = tempfile.mkstemp(prefix=".curation-", dir=path.parent)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(data)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def write_json(path, value):
    atomic_write(path, json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", value):
        raise ValueError(f"Expected a safe nonempty identifier: {value!r}")
    return value


def manifest(path):
    papers = records(path)
    if not papers:
        raise ValueError("The expected-paper manifest is empty")
    seen, identities = set(), set()
    for paper in papers:
        key = identifier(paper.get("id"))
        if key in seen:
            raise ValueError(f"Duplicate paper ID: {key}")
        seen.add(key)
        for field in ("board", "code", "session", "component"):
            if not isinstance(paper.get(field), str) or not paper[field].strip():
                raise ValueError(f"{key}: missing {field}")
        if type(paper.get("year")) is not int or not 1900 <= paper["year"] <= 2200:
            raise ValueError(f"{key}: invalid year")
        identity = tuple(str(paper[field]).strip().casefold() for field in
                         ("board", "code", "year", "session", "component"))
        if identity in identities:
            raise ValueError(f"Duplicate paper identity (possibly a mirror): {key}")
        identities.add(identity)
        for kind in ("qp", "ms"):
            if not isinstance(paper.get(kind), dict):
                raise ValueError(f"{key}: expected a {kind} object, even for a missing file")
    return papers


def source_path(manifest_path, source):
    name = source.get("path")
    if not isinstance(name, str) or not name:
        return None
    return (Path(manifest_path).resolve().parent / name).resolve()


def is_review(value, sha, hash_key="sha256"):
    return (isinstance(value, dict) and value.get(hash_key) == sha
            and all(isinstance(value.get(k), str) and value[k].strip()
                    for k in ("reviewer", "reviewedAt")))
