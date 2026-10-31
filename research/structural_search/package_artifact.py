"""Lossless archives retain raw evidence without committing generated input files."""
import gzip
import json
from .corpus import ROOT,sha,save

def main():
    for name in ('selection.json','heldout.json'):
        p=ROOT/'results'/name
        (ROOT/'results'/(name+'.gz')).write_bytes(gzip.compress(p.read_bytes(),mtime=0))
    # Case generators reconstruct native text inputs; retain their exact input hashes.
    files={str(p.relative_to(ROOT)):sha(p) for p in sorted((ROOT/'results').glob('*.txt'))}
    save(ROOT/'results'/'corpus-hashes.json',files)
    print(json.dumps({p.name:p.stat().st_size for p in (ROOT/'results').glob('*.gz')}))

if __name__=='__main__':main()
