"""Verify immutable study sources and raw evidence archives."""
import gzip
import hashlib
import json
from pathlib import Path


def main():
    root=Path(__file__).resolve().parent
    manifest=json.loads((root/'manifest.json').read_text())
    for name,expected in manifest['files_sha256'].items():
        if hashlib.sha256((root/name).read_bytes()).hexdigest()!=expected:raise RuntimeError(f'Changed evidence: {name}')
    freeze=json.loads((root/'results/freeze.json').read_text())
    selection=gzip.decompress((root/'results/selection.json.gz').read_bytes())
    if hashlib.sha256(selection).hexdigest()!=freeze['selection_sha256']:raise RuntimeError('Selection differs from pre-test seal')
    for name,expected in freeze['source_sha256'].items():
        if hashlib.sha256((root/name).read_bytes()).hexdigest()!=expected:raise RuntimeError(f'Changed frozen source: {name}')
    print(f'Structural artifact: {len(manifest["files_sha256"])} hashes and pre-test source/selection seal match')


if __name__=='__main__':main()
