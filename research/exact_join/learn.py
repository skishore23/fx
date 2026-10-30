"""Outcome-guided planner search. Test cases cannot be loaded by this module."""
import argparse
from dataclasses import asdict
import json
import random
from statistics import median
from time import process_time_ns, perf_counter
from .bench import (ROOT, benchmark, case_summary, digest, fitness, geometric,
                    load_cases, planner_key, policy_solver, save)
from .solvers import BASELINES, Planner


SPACE = {
    'order': ['fixed', 'entropy', 'fiber', 'selectivity', 'dynamic'],
    'verify_at': [0, 1, 2, 4, 8, 16, 32, 64, 128],
    'probes': [0, 1, 2, 3],
    'rank_filter': [False, True],
    'next_order': ['same', 'dynamic', 'selectivity'],
    'inverse': [False, True],
    'image_guard': [False, True],
    'memo': [False, True],
}
INITIAL = [Planner(), Planner(rank_filter=True), Planner('fixed', 0, inverse=False),
           Planner('entropy', 4, inverse=False), Planner('selectivity', 4, inverse=False),
           Planner('dynamic', 4, inverse=False), Planner('fiber', 4),
           Planner('fixed', 4, rank_filter=True)]


def candidate(rng, history, seen):
    """Mutate a successful planner; occasional random restarts preserve exploration."""
    for _ in range(1000):
        if history and rng.random() < 0.85:
            elite = sorted(history, key=lambda row: row['training_ratio'])[:8]
            values = dict(rng.choice(elite)['planner'])
            for key in rng.sample(list(SPACE), rng.choice([1, 1, 2, 3])):
                values[key] = rng.choice(SPACE[key])
        else:
            values = {key: rng.choice(options) for key, options in SPACE.items()}
        result = Planner(**values)
        if planner_key(result) not in seen: return result
    raise RuntimeError('Candidate space exhausted')


def learn(protocol, out):
    cpu_start = process_time_ns(); wall_start = perf_counter()
    training = load_cases(protocol['training']); validation = load_cases(protocol['validation'])
    baseline_times = benchmark(validation, BASELINES, 7, 47001)
    # The reference is fixed before any candidate is tried.
    train_times = benchmark(training, {'reference': BASELINES['hybrid_rank']}, 3, 47003)
    train_reference = {key: row['reference'] for key, row in train_times.items()}
    val_reference = {key: row['hybrid_rank'] for key, row in baseline_times.items()}
    baseline_scores = {name: fitness(baseline_times, val_reference, name) for name in BASELINES}
    best_baseline = min(baseline_scores, key=baseline_scores.get)
    runs = []
    for seed in protocol['search']['seeds']:
        rng = random.Random(seed); history = []; seen = set(); start = process_time_ns()
        for number in range(protocol['search']['candidates']):
            planner = INITIAL[number] if number < len(INITIAL) else candidate(rng, history, seen)
            seen.add(planner_key(planner))
            timings = benchmark(training, {'candidate': policy_solver(planner)}, 3, rng.randrange(2**32))
            score = fitness(timings, train_reference, 'candidate')
            history.append({'number': number, 'planner': asdict(planner),
                            'training_ratio': score, 'training_ns': timings})
            if number % 16 == 0:
                print(f'search seed={seed} candidate={number} best={min(r["training_ratio"] for r in history):.4f}', flush=True)
        shortlist = sorted(history, key=lambda row: row['training_ratio'])[:protocol['search']['shortlist']]
        methods = {str(row['number']): policy_solver(Planner(**row['planner'])) for row in shortlist}
        timings = benchmark(validation, methods, 7, seed ^ 0xA11CE)
        for row in shortlist:
            row['validation_ratio'] = fitness(timings, val_reference, str(row['number']))
        winner = min(shortlist, key=lambda row: row['validation_ratio'])
        runs.append({'seed': seed, 'winner': winner['planner'], 'winner_number': winner['number'],
                     'training_ratio': winner['training_ratio'], 'validation_ratio': winner['validation_ratio'],
                     'cpu_ns': process_time_ns() - start, 'candidates': history,
                     'validation_ns': timings})
        print(f'FROZEN seed={seed} val_ratio={winner["validation_ratio"]:.4f} {winner["planner"]}', flush=True)
    selected = {'protocol_sha256': digest(ROOT / 'protocol.json'),
                'primary_seed': protocol['search']['primary_seed'], 'space': SPACE,
                'strongest_validation_baseline': best_baseline,
                'baseline_validation_scores': baseline_scores,
                'baseline_validation_ns': baseline_times,
                'training_cases': [case_summary(c) for c in training],
                'validation_cases': [case_summary(c) for c in validation],
                'runs': runs, 'total_cpu_ns': process_time_ns() - cpu_start,
                'total_wall_seconds': perf_counter() - wall_start,
                'source_sha256': {p.name: digest(p) for p in sorted(ROOT.glob('*.py'))}}
    save(out, selected)
    print(f'Sealed {out}; strongest validation baseline={best_baseline}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default=str(ROOT / 'results' / 'selection.json'))
    args = parser.parse_args()
    learn(json.loads((ROOT / 'protocol.json').read_text()), args.out)
