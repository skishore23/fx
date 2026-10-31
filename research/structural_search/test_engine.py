"""Independent complete finite-domain oracle for all six generated-plan kernels."""
import itertools
import json
from pathlib import Path
import random
import subprocess
import tempfile
import unittest
from research.exact_join.domains import compose
from .plans import INITIAL,encode,random_tree
from .corpus import ROOT

class EngineTests(unittest.TestCase):
 def test_exact_boolean_and_ternary_banks(self):
    cases=[];rng=random.Random(2701)
    for n in (2,3):
        functions=[bytes(t) for t in itertools.product(range(n),repeat=n)]
        subsets=list(itertools.combinations(functions,2)) if n==2 else [rng.sample(functions,rng.randrange(1,20)) for _ in range(24)]
        for tables in subsets:
            answers={compose(p,s) for p in tables for s in tables}
            cases.append((tables,functions,[int(t in answers) for t in functions]))
    lines=[str(len(cases))]
    for i,(tables,targets,exists) in enumerate(cases):
        lines.append(f'case{i} {len(tables)} {len(targets)}')
        lines.extend(t.hex() for t in tables)
        lines.extend(f'{t.hex()} {e}' for t,e in zip(targets,exists))
    plans=INITIAL+[random_tree(rng) for _ in range(80)]
    with tempfile.TemporaryDirectory() as tmp:
        p=Path(tmp)/'cases.txt';p.write_text('\n'.join(lines)+'\n');exe=Path(tmp)/'engine'
        subprocess.run(['g++','-O3','-std=c++17',str(ROOT/'engine.cpp'),'-o',str(exe)],check=True)
        r=subprocess.run([str(exe),str(p),'1'],input='\n'.join(encode(p) for p in plans)+'\n',text=True,capture_output=True)
        self.assertEqual(r.returncode,0,r.stderr)
        reports=[json.loads(s) for s in r.stdout.splitlines()]
        self.assertEqual(len(reports),len(plans))
        for rows in reports:
            for row,(tables,targets,exists) in zip(rows,cases):
                for target,expected,(i,j) in zip(targets,exists,row['answers']):
                    self.assertEqual(i>=0,bool(expected))
                    if i>=0:self.assertEqual(compose(tables[i],tables[j]),target)
 def test_plan_bounds(self):
    with self.assertRaises(ValueError):encode(['k',6])
    with self.assertRaises(ValueError):encode(['b',0,42,['k',0],['k',1]])

if __name__=='__main__':unittest.main()
