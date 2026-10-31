"""Generate figures and a compact evidence ledger from retained raw measurements."""
import json
from statistics import median
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from .bench import ROOT, digest, geometric, save


def ci(ratios):
    logs = np.log(ratios); rng = np.random.default_rng(83009)
    samples = logs[rng.integers(0, len(logs), (20000, len(logs)))].mean(axis=1)
    return {'geometric_mean': geometric(ratios), 'ci95': list(np.exp(np.quantile(samples, [.025, .975])))}


def main():
    small = json.loads((ROOT / 'results' / 'native-audit.json').read_text())
    large = json.loads((ROOT / 'results' / 'scaling.json').read_text())
    groups = ['permutation', 'affine', 'bitvector', 'automaton', 'local']
    small_stats = {group: ci([median(r['query_batch_cpu_ns']['cpp_pairwise']) /
                             median(r['query_batch_cpu_ns']['cpp_hybrid'])
                             for r in small['cases'] if group == 'all' or r['id'].startswith(group + ':')])
                   for group in ['all'] + groups}
    overview = {'native_length6': small_stats, 'native_length10': large['comparisons'],
                'verified_fx_tasks': sum(json.loads((ROOT / 'results' / name).read_text())['verified']
                                         for name in ('fx-verification.json', 'scaling-fx-verification.json')),
                'algorithm_discovery': 'No improvement over the strongest fixed baseline in any of three search runs.',
                'primary_freeze_commit': '34bc147d5874a45acefcba99d583f62228ededef',
                'scaling_freeze_commit': '7f4a6dc9ccd5dee4e4fdde7480044780a7397816'}
    save(ROOT / 'results' / 'overview.json', overview)
    plt.rcParams.update({'font.size': 10, 'svg.fonttype': 'none', 'svg.hashsalt': 'fx-exact-join-v1',
                         'axes.spines.top': False, 'axes.spines.right': False})
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.2), layout='constrained')
    x = np.arange(len(groups))
    series = [(small_stats, 'Length ≤6', '#525f7f'),
              ({g: large['comparisons'][g]['cpp_pairwise']['warm'] for g in groups}, 'Length ≤10', '#167d8d')]
    for offset, (stats, label, color) in zip([-.14, .14], series):
        values = np.array([stats[g]['geometric_mean'] for g in groups])
        intervals = np.array([stats[g]['ci95'] for g in groups]).T
        axes[0].errorbar(x + offset, values, yerr=[values-intervals[0], intervals[1]-values],
                         fmt='o', capsize=3, label=label, color=color)
    stats = {g: large['comparisons'][g]['cpp_pairwise']['conservative_cold'] for g in groups}
    values = np.array([stats[g]['geometric_mean'] for g in groups]); intervals = np.array([stats[g]['ci95'] for g in groups]).T
    axes[1].errorbar(x, values, yerr=[values-intervals[0], intervals[1]-values], fmt='o', capsize=3, color='#b16b25')
    for ax in axes:
        ax.axhline(1, color='#666666', linestyle='--', linewidth=1)
        ax.set_xticks(x, groups, rotation=25, ha='right'); ax.set_yscale('log')
        ax.set_ylabel('Pairwise CPU / hybrid CPU'); ax.grid(axis='y', alpha=.15)
    axes[0].set_title('Warm C++ queries'); axes[0].legend(frameon=False)
    axes[1].set_title('Length ≤10: conservative cold estimate')
    fig.suptitle('Exact joins scale; planner search selected the existing hybrid in all 3 runs', fontsize=12)
    folder = ROOT / 'figures'; folder.mkdir(exist_ok=True)
    svg = folder / 'native-results.svg'
    fig.savefig(svg, metadata={'Date': None}); fig.savefig(folder / 'native-results.png', dpi=180)
    svg.write_text('\n'.join(line.rstrip() for line in svg.read_text().splitlines()) + '\n')
    print(json.dumps({'native6': small_stats['all'], 'verified_fx_tasks': overview['verified_fx_tasks']}, indent=2))


if __name__ == '__main__': main()
