"""Separate selection and final-test commands enforce the evidence boundary."""
import argparse
import json
import math
from pathlib import Path
import random
import resource
from statistics import median
import subprocess
import time
import numpy as np
from .corpus import ROOT,build,save,sha
from .plans import INITIAL,encode,propose

EXE=Path('/tmp/fx-structural-engine')

def gm(xs):return math.exp(sum(math.log(x) for x in xs)/len(xs))

def evaluate(corpus,plans,repeats=3):
    encoded=[encode(p) for p in plans]
    result=subprocess.run([str(EXE),str(corpus),str(repeats)],input='\n'.join(encoded)+'\n',text=True,capture_output=True)
    if result.returncode:raise RuntimeError(result.stderr)
    rows=[json.loads(line) for line in result.stdout.splitlines()]
    if len(rows)!=len(plans):raise RuntimeError('Missing evaluator result')
    return rows

def cost(rows):return {r['id']:median(r['ns']) for r in rows}

def score(rows,reference):return gm([median(r['ns'])/reference[r['id']] for r in rows])

def search(train,val,seed,control,policy,budget,seconds=8):
    rng=random.Random(seed);history=[];seen=set();spent=0;start=time.perf_counter()
    initial=evaluate(train,INITIAL);ref=cost(initial[2])
    # All controls receive identical initial artifacts and their measured cost.
    for i in range(budget):
        if i<len(INITIAL):plan=INITIAL[i];rows=initial[i]
        else:
            plan=propose(rng,history,seen,control,policy);rows=evaluate(train,[plan])[0]
        spent+=sum(sum(r['ns']) for r in rows)
        history.append({'plan':plan,'score':score(rows,ref),'native_ns':sum(sum(r['ns']) for r in rows),
                        'case_ns':{r['id']:r['ns'] for r in rows}});seen.add(encode(plan))
        if spent>=seconds*1e9:break
    shortlist=sorted(history,key=lambda r:r['score'])[:4]
    validation=evaluate(val,[r['plan'] for r in shortlist]);vref=cost(evaluate(val,[INITIAL[2]])[0])
    for trial,rows in zip(shortlist,validation):trial['validation_score']=score(rows,vref)
    winner=min(shortlist,key=lambda r:r['validation_score'])
    return {'seed':seed,'control':control,'policy':policy,'winner':winner['plan'],
            'validation_score':winner['validation_score'],'evaluations':len(history),'history':history,
            'timed_native_ns':spent+sum(sum(r['ns']) for rows in validation for r in rows),
            'wall_seconds':time.perf_counter()-start}

def select(protocol):
    start=time.perf_counter();child=resource.getrusage(resource.RUSAGE_CHILDREN)
    subprocess.run(['g++','-O3','-DNDEBUG','-std=c++17',str(ROOT/'engine.cpp'),'-o',str(EXE)],check=True)
    out=ROOT/'results';out.mkdir(exist_ok=True)
    for split in ('training','validation'):build(protocol[split],out/split)
    train=out/'training.txt';val=out/'validation.txt'
    fixed=evaluate(val,INITIAL,7);ref=cost(fixed[2]);scores=[score(r,ref) for r in fixed]
    best=min(range(len(INITIAL)),key=lambda i:scores[i]);runs=[]
    for seed in protocol['seeds']:
        for control in ('evolved','random'):
            r=search(train,val,seed,control,0,protocol['search']['evaluations'])
            runs.append(r);print(f'select {control} seed={seed} val={r["validation_score"]:.4f} plan={encode(r["winner"])}',flush=True)
    # Procedure selection is a distinct, limited outer search, with matched budgets.
    meta=[]
    for policy in range(3):
        trials=[search(train,val,seed,'evolved',policy,16) for seed in protocol['seeds']]
        metric=gm([r['validation_score'] for r in trials]);meta.append({'policy':policy,'score':metric,'runs':trials})
        print(f'meta policy={policy} score={metric:.4f}',flush=True)
    selected=min(meta,key=lambda r:r['score'])['policy']
    fresh_train={**protocol['training'],'seeds':[6007,6011,6029]}
    fresh_val={**protocol['validation'],'seeds':[6101,6113,6121]}
    build(fresh_train,out/'fresh-training');build(fresh_val,out/'fresh-validation')
    recursive=[]
    for seed in protocol['seeds']:
        for policy in sorted(set([0,selected])):
            r=search(out/'fresh-training.txt',out/'fresh-validation.txt',seed,'evolved',policy,protocol['search']['evaluations'])
            recursive.append(r);print(f'fresh seed={seed} procedure={policy} val={r["validation_score"]:.4f}',flush=True)
    cpu=resource.getrusage(resource.RUSAGE_CHILDREN)
    selection={'protocol_sha256':sha(ROOT/'protocol.json'),'source_sha256':{p.name:sha(p) for p in sorted(ROOT.iterdir()) if p.suffix in ('.py','.cpp')},
               'fixed_scores':scores,'fixed_winner':INITIAL[best],'runs':runs,'meta':meta,'selected_procedure':selected,
               'fresh_runs':recursive,'selection_wall_seconds':time.perf_counter()-start,
               'child_cpu_seconds':cpu.ru_utime+cpu.ru_stime-child.ru_utime-child.ru_stime,
               'native_budget_note':'8 CPU-second cap per search, 48 evaluations maximum; final trial may cross cap. Timed cap counts kernel/feature/index costs. Full child CPU and wall costs include evaluator startup, verification, parsing and compilation.'}
    save(out/'selection.json',selection)
    freeze={k:selection[k] for k in ('protocol_sha256','source_sha256','fixed_winner','selected_procedure')}
    freeze['selection_sha256']=sha(out/'selection.json')
    freeze['winners']=[{k:r[k] for k in ('seed','control','winner')} for r in runs]
    freeze['fresh_winners']=[{k:r[k] for k in ('seed','policy','winner')} for r in recursive]
    save(out/'freeze.json',freeze);print('SELECTION SEALED; no final corpus has been generated',flush=True)

def final(protocol):
    out=ROOT/'results';s=json.loads((out/'selection.json').read_text())
    if sha(ROOT/'protocol.json')!=s['protocol_sha256']:raise RuntimeError('Protocol changed')
    for name,h in s['source_sha256'].items():
        if sha(ROOT/name)!=h:raise RuntimeError(f'Source changed: {name}')
    subprocess.run(['g++','-O3','-DNDEBUG','-std=c++17',str(ROOT/'engine.cpp'),'-o',str(EXE)],check=True)
    corpora=[('test',protocol['test']),('fresh-test',{**protocol['test'],'seeds':[7001,7013,7019,7027]})]
    reports={}
    for split,spec in corpora:
        records=build(spec,out/split);methods={f'fixed_{i}':p for i,p in enumerate(INITIAL)}
        relevant=s['runs'] if split=='test' else s['fresh_runs']
        for r in relevant:
            label=f'{r.get("control","procedure")}_{r["seed"]}_{r["policy"]}'
            methods[label]=r['winner']
        unique={encode(p):p for p in methods.values()};samples={key:[] for key in unique};rng=random.Random(87013)
        for repeat in range(7):
            keys=list(unique);rng.shuffle(keys)
            rows=evaluate(out/(split+'.txt'),[unique[k] for k in keys],1)
            for key,values in zip(keys,rows):samples[key].append(values)
            print(f'{split} repeat={repeat+1} unique_plans={len(keys)}',flush=True)
        reports[split]={'cases':records,'methods':methods,'samples':samples}
    save(out/'heldout.json',{'selection_sha256':sha(out/'selection.json'),'reports':reports})
    print('Final measurements saved',flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('phase',choices=['select','final']);args=parser.parse_args()
    p=json.loads((ROOT/'protocol.json').read_text());select(p) if args.phase=='select' else final(p)
