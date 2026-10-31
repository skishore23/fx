"""Paired domain bootstrap; the primary baseline was selected on validation."""
import json
from statistics import median
import numpy as np
from .bench import ROOT, geometric, save


def compare(cases, numerator, denominator, cold=False):
    ratios = []
    for row in cases:
        if not row['queries']: continue
        values = {name: median(row['query_batch_cpu_ns'][name]) for name in (numerator, denominator)}
        if cold:
            values = {name: value + row['preprocessing_ns'][name] for name, value in values.items()}
        ratios.append(values[numerator] / values[denominator])
    logs = np.log(ratios); rng = np.random.default_rng(81023)
    means = logs[rng.integers(0, len(logs), (20000, len(logs)))].mean(axis=1)
    return {'geometric_mean': float(np.exp(logs.mean())),
            'ci95': list(np.exp(np.quantile(means, [0.025, 0.975]))),
            'domains': len(ratios), 'median': median(ratios),
            'wins': sum(r > 1 for r in ratios), 'losses': sum(r < 1 for r in ratios)}


def main():
    report = json.loads((ROOT / 'results' / 'heldout.json').read_text())
    selection = json.loads((ROOT / 'results' / 'selection.json').read_text())
    rows = report['cases']; primary = report['primary']; baseline = report['baseline']
    groups = {'all': rows, 'unseen_families': [r for r in rows if r['id'].split(':')[0] in ('automaton', 'local')]}
    groups.update({f: [r for r in rows if r['id'].startswith(f + ':')]
                   for f in ('permutation', 'affine', 'bitvector', 'automaton', 'local')})
    stats = {}
    for group, cases in groups.items():
        stats[group] = {name: {'warm': compare(cases, name, primary), 'cold_estimate': compare(cases, name, primary, True)}
                        for name in ('pairwise', 'numpy', 'inverse_hash', 'bitset_entropy', 'hybrid', 'hybrid_rank', baseline)}
    saved = sum((median(r['query_batch_cpu_ns'][baseline]) - median(r['query_batch_cpu_ns'][primary])) / r['queries']
                for r in rows if r['queries']) / sum(bool(r['queries']) for r in rows)
    analysis = {'primary_baseline': baseline, 'primary_method': primary,
                'queries': sum(r['queries'] for r in rows), 'domains': len(rows),
                'saturated_domains': [r['id'] for r in rows if r['queries'] < 8],
                'groups': stats, 'discovery_cpu_seconds': selection['total_cpu_ns'] / 1e9,
                'mean_saved_cpu_ns_per_query_vs_primary_baseline': saved,
                'discovery_break_even_queries': selection['total_cpu_ns'] / saved if saved > 0 else None,
                'interpretation': 'All three search seeds selected an existing baseline. The learned planner is identical to hybrid; this experiment does not demonstrate an improvement beyond the strongest fixed baseline.'}
    save(ROOT / 'results' / 'analysis.json', analysis)
    print(json.dumps(analysis, indent=2))


if __name__ == '__main__': main()
