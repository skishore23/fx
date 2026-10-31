"""Retain every run; bootstrap domains rather than pretending repeats are samples."""
import gzip
import json
from statistics import median
import numpy as np
from .corpus import ROOT,save
from .plans import encode

def read(name):
    p=ROOT/'results'/name
    return json.loads(p.read_text() if p.exists() else gzip.decompress((ROOT/'results'/(name+'.gz')).read_bytes()))

def compare(report,a,b,include_bank=True):
    cases={r['id']:r for r in report['cases']}
    def values(name):
        samples=report['samples'][encode(report['methods'][name])];result={}
        for rows in samples:
            for row in rows:result.setdefault(row['id'],[]).extend(row['ns'])
        return {name:median(ns)+(cases[name]['bank_ns'] if include_bank else 0) for name,ns in result.items()}
    av,bv=values(a),values(b);ratios=[av[k]/bv[k] for k in av]
    logs=np.log(ratios);rng=np.random.default_rng(91009)
    draws=logs[rng.integers(0,len(logs),(20000,len(logs)))].mean(axis=1)
    return {'speedup_of_denominator':float(np.exp(logs.mean())),'ci95':list(np.exp(np.quantile(draws,[.025,.975]))),
            'domain_speedups':dict(zip(av,ratios)),
            'domains':len(ratios),'wins_for_denominator':sum(r>1 for r in ratios),'losses_for_denominator':sum(r<1 for r in ratios),
            'mean_saved_cpu_ns_per_query':float(np.mean([(av[k]-bv[k])/len(cases[k]['targets']) for k in av]))}

def main():
    s=read('selection.json');h=read('heldout.json');p=json.loads((ROOT/'protocol.json').read_text())
    report=h['reports']['test'];baseline=next(f'fixed_{i}' for i,plan in enumerate(__import__('research.structural_search.plans',fromlist=['INITIAL']).INITIAL) if plan==s['fixed_winner'])
    runs=[]
    for seed in p['seeds']:
        evolved=f'evolved_{seed}_0';random=f'random_{seed}_0'
        runs.append({'seed':seed,'vs_selected_fixed':compare(report,baseline,evolved),
                     'vs_equal_evaluation_random':compare(report,random,evolved),
                     'native_only_vs_selected_fixed':compare(report,baseline,evolved,False),
                     'vs_expert_dispatch':compare(report,'fixed_6',evolved)})
    fresh=h['reports']['fresh-test'];paired=[];selected=s['selected_procedure']
    for seed in p['seeds']:
        a=f'evolved_{seed}_0';b=f'evolved_{seed}_{selected}'
        paired.append({'seed':seed,'original_vs_selected':compare(fresh,a,b)})
    matrix=np.array([list(r['original_vs_selected']['domain_speedups'].values()) for r in paired])
    logs=np.log(matrix);rng=np.random.default_rng(91021)
    draws=[]
    for _ in range(20000):
        rows=rng.integers(0,logs.shape[0],logs.shape[0]);cols=rng.integers(0,logs.shape[1],logs.shape[1])
        draws.append(logs[np.ix_(rows,cols)].mean())
    meta_aggregate={'speedup_of_selected':float(np.exp(logs.mean())),
                    'ci95':list(np.exp(np.quantile(draws,[.025,.975]))),
                    'bootstrap':'two-way resampling of discovery seeds and shared final domains',
                    'reruns':matrix.shape[0],'domains':matrix.shape[1]}
    primary=runs[0];success=primary['vs_selected_fixed']['speedup_of_denominator']>=1.2 and primary['vs_selected_fixed']['ci95'][0]>1 and primary['vs_equal_evaluation_random']['ci95'][0]>1
    summary={'primary_seed':p['seeds'][0],'selected_fixed_baseline':baseline,'primary_success':bool(success),'runs':runs,
             'fresh_paired_improver_runs':paired,'selected_procedure':selected,'paired_improver_aggregate':meta_aggregate,
             'fixed_comparisons':{f'fixed_{i}':compare(report,f'fixed_{i}',baseline) for i in range(8)},
             'declared_kernel_comparisons':{'pairwise_vs_forward_deduplicated':compare(report,'fixed_0','fixed_4'),
                                            'inverse_fibers_vs_forward_deduplicated':compare(report,'fixed_2','fixed_4')},
             'task_counts':{split:sum(len(c['targets']) for c in r['cases']) for split,r in h['reports'].items()},
             'shortfalls':{split:[{'id':c['id'],'observed':len(c['targets']),'requested':c['requested']} for c in r['cases'] if len(c['targets'])!=c['requested']] for split,r in h['reports'].items()},
             'selection_child_cpu_seconds':s['child_cpu_seconds'],'selection_wall_seconds':s['selection_wall_seconds'],
             'budget_limit':'Searches have identical evaluation/native-kernel CPU ceilings, not exactly matched whole-process CPU. Child CPU and wall time for the complete selection phase include compilation, process startup, verification and the outer study. No claim of matched-total-cost superiority is permitted.',
             'limits':['authored six-kernel grammar and bounded dispatch-tree synthesis','synthetic finite functions, no application-derived workload','single host','small-to-large transfer deliberately changes bank size','semantic-pair goal pool is sampled, not exhaustive uniform semantics','fixed evaluator, no runtime modification of framework source']}
    save(ROOT/'results'/'analysis.json',summary)
    print(json.dumps({'tasks':summary['task_counts'],'success':summary['primary_success'],'primary':primary,'paired':paired},indent=2))

if __name__=='__main__':main()
