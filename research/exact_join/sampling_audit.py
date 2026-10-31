"""Post hoc audit: exhausting a random sampler is not semantic saturation."""
import json
from .bench import ROOT, save
from .domains import bank, compose, domain


def main():
    records = []
    for seed, states, actions, depth, observed in [(2011, 64, 6, 5, 0), (53, 32, 5, 3, 2)]:
        d = domain('affine', seed, states, actions); tables, _ = bank(d, depth)
        known = set(tables); frontier = {bytes(range(states)): ()}
        for _ in range(2 * depth):
            following = {}
            for prefix, word in frontier.items():
                for i, action in enumerate(d.actions):
                    following.setdefault(compose(prefix, action), word + (i,))
            frontier = following
        novel = sorted(set(frontier) - known); witness = novel[0]
        records.append({'family': 'affine', 'seed': seed, 'states': states, 'half_depth': depth,
                        'random_sampler_observed_distinct_novel_targets': observed,
                        'reachable_tables_at_exact_goal_length': len(frontier),
                        'novel_tables_outside_half_bank': len(novel), 'semantically_saturated': False,
                        'witness': {'target': witness.hex(), 'program': list(frontier[witness]),
                                    'operations': [t.hex() for t in d.actions]}})
    result = {'status': 'post hoc benchmark audit; no selection or timing data changed',
              'interpretation': 'The historical saturated_domains fields mean random-sampler exhaustion, not a closed semantic bank. The sampler missed rare reachable behavior.',
              'cases': records}
    save(ROOT / 'results' / 'sampling-audit.json', result)
    print(json.dumps([{k: v for k, v in r.items() if k != 'witness'} for r in records], indent=2))


if __name__ == '__main__': main()
