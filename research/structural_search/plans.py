"""Bounded executable search-plan ASTs; no arbitrary native source execution."""
import json
import random

THRESHOLDS = {0: [0,25,50,75,99,100], 1: [25,50,75,90,99], 2: [1,4,8,16],
              3: [16,32,64,128], 4: [128,512,2048,8192], 5: [25,50,75,90,99]}
FEATURES = ['bijection_percent','mean_bank_rank_percent','query_count','states','bank_size','mean_target_rank_percent']
KERNELS = ['pairwise','inverse_hash','inverse_fibers','forward_constraints','forward_deduplicated','forward_hybrid']
INITIAL = [['k', k] for k in range(6)] + [
    ['b',0,99,['k',4],['k',1]], ['b',5,90,['k',2],['k',4]]]


def encode(tree, depth=0):
    if depth > 3: raise ValueError('Plan depth exceeds three')
    if tree[0] == 'k' and len(tree) == 2 and type(tree[1]) is int and 0 <= tree[1] < 6:
        return f'k {tree[1]}'
    if tree[0] == 'b' and len(tree) == 5 and tree[1] in THRESHOLDS and tree[2] in THRESHOLDS[tree[1]]:
        return f'b {tree[1]} {tree[2]} {encode(tree[3],depth+1)} {encode(tree[4],depth+1)}'
    raise ValueError('Invalid search plan')


def random_tree(rng, depth=0, grow=.65):
    if depth == 3 or rng.random() > grow: return ['k',rng.randrange(6)]
    f=rng.randrange(6)
    return ['b',f,rng.choice(THRESHOLDS[f]),random_tree(rng,depth+1,grow),random_tree(rng,depth+1,grow)]


def mutate(rng, tree, policy):
    tree=json.loads(json.dumps(tree)); paths=[]
    def walk(t,path):
        paths.append(path)
        if t[0]=='b': walk(t[3],path+[3]); walk(t[4],path+[4])
    walk(tree,[]); path=rng.choice(paths); grow=[.5,.85,.3][policy]
    replacement=random_tree(rng,len(path),grow)
    if not path: return replacement
    parent=tree
    for p in path[:-1]: parent=parent[p]
    parent[path[-1]]=replacement
    return tree


def propose(rng, history, seen, control, policy):
    for _ in range(2000):
        if control=='random' or not history or rng.random() < [.2,.1,.4][policy]:
            plan=random_tree(rng,grow=[.5,.85,.3][policy])
        else:
            elite=sorted(history,key=lambda r:r['score'])[:6]
            plan=mutate(rng,rng.choice(elite)['plan'],policy)
        if encode(plan) not in seen: return plan
    raise RuntimeError('Exhausted unique proposal attempts')
