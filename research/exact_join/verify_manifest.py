"""Check retained evidence before any experiment output can be replaced."""
import hashlib
import json
from pathlib import Path


def main():
    folder = Path(__file__).resolve().parent
    repo = folder.parents[1]
    manifest = json.loads((folder / 'manifest.json').read_text())
    for name, expected in manifest['files_sha256'].items():
        actual = hashlib.sha256((repo / name).read_bytes()).hexdigest()
        if actual != expected: raise RuntimeError(f'Artifact changed: {name}')
    print(f'Artifact integrity: {len(manifest["files_sha256"])} source and evidence files match')


if __name__ == '__main__': main()
