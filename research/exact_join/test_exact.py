"""Exhaustive small-domain checks cover satisfiable and impossible targets."""
import itertools
import random
import unittest
from .domains import bank, domain, goals, verify
from .index import BankIndex
from .solvers import BASELINES, Planner, indexed, pairwise


class ExactJoinTests(unittest.TestCase):
    def test_all_boolean_banks_and_targets(self):
        functions = [bytes(v) for v in itertools.product(range(2), repeat=2)]
        planners = [Planner(order, threshold, rank_filter=rank, next_order=phase,
                            inverse=inverse, image_guard=True, memo=True)
                    for order in ('fixed', 'entropy', 'fiber', 'selectivity', 'dynamic')
                    for threshold in (0, 2) for rank in (False, True)
                    for inverse in (False, True) for phase in ('same', 'dynamic')]
        for n in range(1, 5):
            for tables in itertools.combinations(functions, n):
                index = BankIndex(list(tables))
                for target in functions:
                    exists = pairwise(tables, target) is not None
                    for solver in BASELINES.values():
                        answer = solver(index, target)
                        self.assertEqual(answer is not None, exists)
                        if answer is not None:
                            from .domains import compose
                            self.assertEqual(compose(tables[answer[0]], tables[answer[1]]), target)
                    for planner in planners:
                        answer = indexed(index, target, planner)
                        self.assertEqual(answer is not None, exists)

    def test_random_ternary_noninvertible_joins(self):
        rng = random.Random(13)
        functions = [bytes(v) for v in itertools.product(range(3), repeat=3)]
        for _ in range(30):
            tables = rng.sample(functions, rng.randrange(1, 20)); index = BankIndex(tables)
            for target in functions:
                exists = pairwise(tables, target) is not None
                for order in ('fixed', 'entropy', 'fiber', 'selectivity', 'dynamic'):
                    for cap in (0, 1, 2):
                        answer = indexed(index, target, Planner(order, 1, cap, True, 'selectivity', True, True, True))
                        self.assertEqual(answer is not None, exists)

    def test_reconstructed_programs_and_exclusion(self):
        for family in ('permutation', 'affine', 'bitvector', 'automaton', 'local'):
            d = domain(family, 77, 16, 4); tables, words = bank(d, 3)
            index = BankIndex(tables)
            for target in goals(d, 3, 5, tables):
                self.assertNotIn(target, tables)
                for solver in BASELINES.values():
                    i, j = solver(index, target)
                    self.assertTrue(verify(d, words[i], words[j], target))


if __name__ == '__main__': unittest.main()
