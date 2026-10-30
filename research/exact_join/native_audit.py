"""Post hoc implementation audit; never used to select the learned policy."""
import json
from pathlib import Path
from statistics import median
import subprocess
import tempfile
from .bench import ROOT, digest, geometric, save
from .domains import Domain, bank


def main():
    heldout = json.loads((ROOT / 'results' / 'heldout.json').read_text())
    grouped = {}
    for proof in heldout['proofs']: grouped.setdefault(proof['case'], []).append(proof)
    lines = [str(len(grouped))]
    for name, proofs in grouped.items():
        first = proofs[0]; operations = tuple(bytes.fromhex(t) for t in first['operations'])
        tables, _ = bank(Domain(name, 0, len(operations[0]), operations), 3)
        lines.append(f'{name} {len(tables)} {len(proofs)}')
        lines.extend(t.hex() for t in tables); lines.extend(p['target'] for p in proofs)
    with tempfile.TemporaryDirectory() as tmp:
        executable = Path(tmp) / 'exact-join'
        command = ['g++', '-O3', '-DNDEBUG', '-std=c++17', str(ROOT / 'native.cpp'), '-o', str(executable)]
        subprocess.run(command, check=True)
        result = subprocess.run([str(executable)], input='\n'.join(lines), text=True, capture_output=True, check=True)
    cases = json.loads(result.stdout)
    python = {r['id']: r for r in heldout['cases']}
    aggregate = {}
    groups = {'all': cases, **{f: [r for r in cases if r['id'].startswith(f + ':')]
                                for f in ('permutation', 'affine', 'bitvector', 'automaton', 'local')}}
    for group, rows in groups.items():
        aggregate[group] = {}
        for base in ('cpp_pairwise', 'cpp_inverse_hash'):
            ratios = [median(r['query_batch_cpu_ns'][base]) / median(r['query_batch_cpu_ns']['cpp_hybrid']) for r in rows]
            aggregate[group][base + '_over_cpp_hybrid'] = geometric(ratios)
        ratios = [median(python[r['id']]['query_batch_cpu_ns']['hybrid']) /
                  median(r['query_batch_cpu_ns']['cpp_hybrid']) for r in rows]
        aggregate[group]['python_hybrid_over_cpp_hybrid'] = geometric(ratios)
    audit = {'status': 'supplemental post hoc host-implementation audit; not the preregistered primary comparison',
             'compiler': subprocess.check_output(['g++', '--version'], text=True).splitlines()[0],
             'flags': '-O3 -DNDEBUG -std=c++17', 'source_sha256': digest(ROOT / 'native.cpp'),
             'heldout_sha256': digest(ROOT / 'results' / 'heldout.json'),
             'cases': cases, 'geometric_ratios': aggregate,
             'preparation_note': 'C++ preparation is the shared union of all indexes and is excluded from warm query timing. Compare cold costs only with this limitation disclosed.'}
    save(ROOT / 'results' / 'native-audit.json', audit)
    print(json.dumps(aggregate, indent=2))


if __name__ == '__main__': main()
