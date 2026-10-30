"""Shared native CPU timing and exhaustive result verification."""
from dataclasses import asdict
import hashlib
import json
import math
from pathlib import Path
import random
from statistics import median
from time import process_time_ns
from .domains import bank, domain, goals, verify
from .index import BankIndex
from .solvers import Planner, indexed


ROOT = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def save(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def geometric(values):
    return math.exp(sum(math.log(v) for v in values) / len(values))


def load_cases(spec):
    cases = []
    for family in spec['families']:
        for seed in spec['seeds']:
            d = domain(family, seed, spec['states'], spec['actions'])
            start = process_time_ns()
            tables, words = bank(d, spec['half_depth'])
            bank_ns = process_time_ns() - start
            targets = goals(d, spec['half_depth'], spec['queries'], tables)
            cases.append({'id': f'{family}:{seed}', 'domain': d,
                          'index': BankIndex(tables), 'words': words,
                          'targets': targets, 'bank_ns': bank_ns})
    return cases


def measure(case, solver):
    """Verification is outside the timed region, identical for every method."""
    start = process_time_ns()
    answers = [solver(case['index'], target) for target in case['targets']]
    elapsed = process_time_ns() - start
    for target, answer in zip(case['targets'], answers):
        if answer is None:
            raise AssertionError(f"Lost constructed solution: {case['id']}")
        i, j = answer
        if not verify(case['domain'], case['words'][i], case['words'][j], target):
            raise AssertionError(f"Incorrect solution: {case['id']}")
    return elapsed


def benchmark(cases, methods, repeats, seed):
    rng = random.Random(seed)
    result = {}
    for case in cases:
        times = {name: [] for name in methods}
        if case['targets']:
            for _ in range(repeats):
                names = list(methods); rng.shuffle(names)
                for name in names:
                    times[name].append(measure(case, methods[name]))
        result[case['id']] = times
    return result


def policy_solver(planner):
    return lambda index, target: indexed(index, target, planner)


def fitness(timings, reference, name):
    ratios = [median(times[name]) / median(reference[key])
              for key, times in timings.items() if times[name]]
    return geometric(ratios) if ratios else float('inf')


def case_summary(case):
    index = case['index']
    return {'id': case['id'], 'states': index.states, 'bank_size': index.size,
            'queries': len(case['targets']), 'bank_ns': case['bank_ns'],
            'components_ns': index.component_ns,
            'targets_sha256': hashlib.sha256(b''.join(case['targets'])).hexdigest()}


def preprocessing_ns(case, name, planner=None):
    # Each method is charged for its own required components, not the union.
    components = set()
    if name == 'numpy': components.add('numpy')
    elif name == 'inverse_hash': components.update(('exact', 'fibers'))
    elif name != 'pairwise':
        p = planner or {
            'bitset_fixed': Planner('fixed', 0, inverse=False),
            'bitset_entropy': Planner('entropy', 4, inverse=False),
            'bitset_selectivity': Planner('selectivity', 4, inverse=False),
            'bitset_dynamic': Planner('dynamic', 4, inverse=False),
            'hybrid': Planner(), 'hybrid_rank': Planner(rank_filter=True),
        }[name]
        components.update(('bits', 'fibers'))
        if p.order in ('entropy', 'selectivity', 'dynamic') or p.next_order in ('dynamic', 'selectivity'):
            components.add('statistics')
        if p.inverse: components.add('exact')
        if p.rank_filter: components.add('ranks')
    return case['bank_ns'] + sum(case['index'].component_ns[c] for c in components)


def planner_key(planner):
    return json.dumps(asdict(planner), sort_keys=True)
