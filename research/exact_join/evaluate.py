"""Final held-out evaluation; selection is read-only and hash checked."""
import argparse
from dataclasses import asdict
import json
import os
import platform
from statistics import median
import sys
from time import perf_counter, process_time_ns
import numpy as np
from .bench import (ROOT, benchmark, case_summary, digest, load_cases,
                    policy_solver, preprocessing_ns, save)
from .solvers import BASELINES, Planner


def main(selection_path, out):
    selection = json.loads(selection_path.read_text())
    for name, expected in selection['source_sha256'].items():
        if digest(ROOT / name) != expected: raise RuntimeError(f'Changed source: {name}')
    if digest(ROOT / 'protocol.json') != selection['protocol_sha256']:
        raise RuntimeError('Changed protocol after selection')
    protocol = json.loads((ROOT / 'protocol.json').read_text())
    methods = dict(BASELINES); aliases = {}; planners = {}
    for run in selection['runs']:
        p = Planner(**run['winner']); name = f'learned_{run["seed"]}'
        # Do not manufacture an apparent speedup by retiming identical programs.
        if p == Planner(): aliases[name] = 'hybrid'
        elif p == Planner(rank_filter=True): aliases[name] = 'hybrid_rank'
        else:
            match = next((key for key, value in planners.items() if value == p), None)
            if match: aliases[name] = match
            else: methods[name] = policy_solver(p); planners[name] = p
    start_cpu = process_time_ns(); start_wall = perf_counter()
    cases = load_cases(protocol['test']); rows = []; proofs = []
    for number, case in enumerate(cases):
        times = benchmark([case], methods, protocol['timing']['repeats'], 71000 + number)[case['id']]
        for alias, original in aliases.items(): times[alias] = list(times[original])
        costs = {name: preprocessing_ns(case, name, planners.get(name)) for name in methods}
        for alias, original in aliases.items(): costs[alias] = costs[original]
        row = case_summary(case); row.update({'query_batch_cpu_ns': times, 'preprocessing_ns': costs,
                    'invertible_suffix_fraction': sum(i is not None for i in case['index'].inverses) / case['index'].size,
                    'median_target_rank': median([len(set(t)) for t in case['targets']]) if case['targets'] else None})
        rows.append(row)
        primary = next(r for r in selection['runs'] if r['seed'] == selection['primary_seed'])
        solver = policy_solver(Planner(**primary['winner']))
        for target in case['targets']:
            i, j = solver(case['index'], target)
            proofs.append({'case': case['id'], 'operations': [t.hex() for t in case['domain'].actions],
                           'target': target.hex(), 'program': list(case['words'][i] + case['words'][j])})
        print(f'test {number + 1}/{len(cases)} {case["id"]} bank={case["index"].size} queries={len(case["targets"])}', flush=True)
    result = {'selection_sha256': digest(selection_path), 'protocol_sha256': digest(ROOT / 'protocol.json'),
              'environment': {'python': sys.version, 'numpy': np.__version__, 'platform': platform.platform(),
                              'cpu_count': os.cpu_count(), 'clock': 'process_time_ns',
                              'cpu_model': next((s.split(':', 1)[1].strip() for s in open('/proc/cpuinfo') if s.startswith('model name')), 'unknown')},
              'primary': f'learned_{selection["primary_seed"]}',
              'baseline': selection['strongest_validation_baseline'], 'identical_method_aliases': aliases,
              'cases': rows, 'proofs': proofs, 'evaluation_cpu_ns': process_time_ns() - start_cpu,
              'evaluation_wall_seconds': perf_counter() - start_wall,
              'cold_cost_definition': 'Bank construction plus measured required index components plus median warm batch CPU. Attributed estimate; not an independent fresh-process cold-latency measurement.',
              'test_source_sha256': digest(__file__)}
    save(out, result)
    print(f'Wrote {out}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--selection', type=__import__('pathlib').Path, default=ROOT / 'results' / 'selection.json')
    parser.add_argument('--out', default=str(ROOT / 'results' / 'heldout.json'))
    args = parser.parse_args(); main(args.selection, args.out)
