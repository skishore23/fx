"""Was a selected test-time branch ever exercised during training?"""
import gzip
import json
from .corpus import ROOT,save
from research.exact_join.domains import compose


def load(name):
    p=ROOT/'results'/name
    return json.loads(p.read_text() if p.exists() else gzip.decompress((ROOT/'results'/(name+'.gz')).read_bytes()))


def features(case):
    ops=[bytes.fromhex(t) for t in case['operations']];tables=[]
    for word in case['words']:
        t=bytes(range(case['states']))
        for i in word:t=compose(t,ops[i])
        tables.append(t)
    ranks=[len(set(t)) for t in tables];n=case['states'];b=len(tables);targets=case['targets']
    return [100*sum(r==n for r in ranks)//b,100*sum(ranks)//(n*b),len(targets),n,b,
            100*sum(len(set(bytes.fromhex(t))) for t in targets)//(n*len(targets)) if targets else 0]


def route(plan,feature,path=''):
    if plan[0]=='k':return path,plan[1]
    left=feature[plan[1]]<=plan[2]
    return route(plan[3] if left else plan[4],feature,path+('L' if left else 'R'))


def main():
    selection=load('selection.json');heldout=load('heldout.json');records=[]
    for split,train_file,runs in [('test','training.json',selection['runs']),('fresh-test','fresh-training.json',selection['fresh_runs'])]:
        train=load(train_file);tr={r['id']:features(r) for r in train if r['targets']}
        test=heldout['reports'][split]['cases'];te={r['id']:features(r) for r in test if r['targets']}
        for run in runs:
            seen={route(run['winner'],f)[0] for f in tr.values()}
            visited={key:route(run['winner'],f) for key,f in te.items()}
            unseen=[key for key,(path,kernel) in visited.items() if path not in seen]
            records.append({'split':split,'seed':run['seed'],'control':run.get('control','procedure'),
                            'policy':run['policy'],'training_leaf_paths':sorted(seen),
                            'test_domains_with_unexercised_leaf':unseen,'test_routes':visited})
    save(ROOT/'results'/'coverage.json',{'interpretation':'A novel test-time branch that was never exercised during learning is unvalidated extrapolation, not evidence that feedback taught its behavior.','records':records})
    print(json.dumps([{k:v for k,v in r.items() if k!='test_routes'} for r in records],indent=2))

if __name__=='__main__':main()
