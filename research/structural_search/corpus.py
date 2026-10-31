"""Reproducible specifications; goal construction never reaches the learner."""
import hashlib
import json
from pathlib import Path
import random
from time import process_time_ns
from research.exact_join.domains import bank, compose, domain

ROOT=Path(__file__).resolve().parent

def save(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,indent=2)+'\n')

def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def build(spec,out):
    records=[];lines=[]
    for family in spec['families']:
        for seed in spec['seeds']:
            d=domain(family,seed,spec['states'],spec['actions']); start=process_time_ns()
            tables,words=bank(d,spec['half_depth']); cost=process_time_ns()-start
            rng=random.Random(seed^0xDA71);known=set(tables);targets=[]; strata=[]
            for _ in range(spec['queries']*200):
                t=bytes(range(d.states))
                for _ in range(2*spec['half_depth']): t=compose(t,rng.choice(d.actions))
                if t not in known:
                    targets.append(t);known.add(t);strata.append('random_word')
                if len(targets)>=spec['queries']//2:break
            pool=set()
            for _ in range(2000): pool.add(compose(rng.choice(tables),rng.choice(tables)))
            available=sorted(pool-known);rng.shuffle(available)
            for t in available[:spec['queries']-len(targets)]:targets.append(t);strata.append('semantic_pair_pool')
            name=f'{family}:{seed}'
            records.append({'id':name,'states':d.states,'operations':[t.hex() for t in d.actions],
                            'bank_size':len(tables),'words':words,'bank_ns':cost,'targets':[t.hex() for t in targets],
                            'strata':strata,'requested':spec['queries']})
            if targets:
                lines.append(f'{name} {len(tables)} {len(targets)}\n'+'\n'.join(t.hex() for t in tables)+'\n'+'\n'.join(t.hex()+' 1' for t in targets))
    save(str(out)+'.json',records)
    Path(str(out)+'.txt').write_text(str(len(lines))+'\n'+'\n'.join(lines)+'\n')
    return records
