"""New seeds and deeper words, fixed algorithms; no policy feedback."""
import json
from pathlib import Path
from statistics import median
import subprocess
import tempfile
from time import process_time_ns
import numpy as np
from .bench import ROOT, digest, geometric, save
from .domains import bank, domain, goals, verify
from .solvers import inverse_hash
from .index import BankIndex


def main():
    protocol = json.loads((ROOT / 'scaling-protocol.json').read_text())
    lines = [str(len(protocol['families']) * len(protocol['seeds']))]; metadata = []
    for family in protocol['families']:
        for seed in protocol['seeds']:
            d = domain(family, seed, protocol['states'], protocol['actions'])
            start = process_time_ns(); tables, words = bank(d, protocol['half_depth'])
            bank_ns = process_time_ns() - start
            targets = goals(d, protocol['half_depth'], protocol['queries'], tables)
            name = f'{family}:{seed}'
            lines.append(f'{name} {len(tables)} {len(targets)}')
            lines.extend(t.hex() for t in tables); lines.extend(t.hex() for t in targets)
            metadata.append({'id': name, 'bank_size': len(tables), 'queries': len(targets), 'bank_ns': bank_ns,
                             'targets': [t.hex() for t in targets], 'operations': [t.hex() for t in d.actions]})
            print(f'prepared scaling {name} bank={len(tables)} queries={len(targets)}', flush=True)
    with tempfile.TemporaryDirectory() as tmp:
        executable = Path(tmp) / 'exact-join'
        subprocess.run(['g++', '-O3', '-DNDEBUG', '-std=c++17', str(ROOT / 'native.cpp'), '-o', str(executable)], check=True)
        result = subprocess.run([str(executable)], input='\n'.join(lines), text=True, capture_output=True, check=True)
    timings = json.loads(result.stdout)
    for meta, timing in zip(metadata, timings):
        assert meta['id'] == timing['id']; meta.update(timing)
    def interval(rows, numerator, cold=False):
        ratios = []
        for row in rows:
            if not row['queries']: continue
            a = median(row['query_batch_cpu_ns'][numerator]); b = median(row['query_batch_cpu_ns']['cpp_hybrid'])
            if cold:
                # Deliberately charge hybrid for the full union, including unused indexes.
                a += row['bank_ns']; b += row['bank_ns'] + row['preparation_ns']
            ratios.append(a / b)
        if not ratios: return None
        logs = np.log(ratios); rng = np.random.default_rng(82019)
        means = logs[rng.integers(0, len(logs), (20000, len(logs)))].mean(axis=1)
        return {'geometric_mean': geometric(ratios), 'ci95': list(np.exp(np.quantile(means, [.025, .975]))),
                'domains': len(ratios), 'wins': sum(r > 1 for r in ratios), 'losses': sum(r < 1 for r in ratios)}
    groups = {'all': metadata, **{f: [r for r in metadata if r['id'].startswith(f + ':')] for f in protocol['families']}}
    stats = {group: {base: {'warm': interval(rows, base), 'conservative_cold': interval(rows, base, True)}
                     for base in ('cpp_pairwise', 'cpp_inverse_hash')} for group, rows in groups.items()}
    report = {'protocol_sha256': digest(ROOT / 'scaling-protocol.json'),
              'source_sha256': digest(ROOT / 'native.cpp'), 'cases': metadata, 'comparisons': stats,
              'queries': sum(r['queries'] for r in metadata),
              'saturated_domains': [r['id'] for r in metadata if r['queries'] < protocol['queries']]}
    save(ROOT / 'results' / 'scaling.json', report)
    print(json.dumps({'queries': report['queries'], 'all': stats['all'], 'saturated': report['saturated_domains']}, indent=2))


if __name__ == '__main__': main()
