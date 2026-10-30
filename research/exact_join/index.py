"""Exact semantic bank indexes. Preprocessing costs are measured by the runner."""
import math
import numpy as np
from time import process_time_ns


class BankIndex:
    def __init__(self, tables: list[bytes]):
        times = {}; start = process_time_ns()
        self.tables = tables
        self.size = len(tables)
        self.states = len(tables[0])
        self.all = (1 << self.size) - 1
        self.exact = {table: i for i, table in enumerate(tables)}
        times['exact'] = process_time_ns() - start; start = process_time_ns()
        self.rows = np.frombuffer(b"".join(tables), dtype=np.uint8).reshape(self.size, self.states)
        times['numpy'] = process_time_ns() - start; start = process_time_ns()
        self.bits = [[0] * self.states for _ in range(self.states)]
        for i, table in enumerate(tables):
            bit = 1 << i
            for x, value in enumerate(table): self.bits[x][value] |= bit
        times['bits'] = process_time_ns() - start; start = process_time_ns()
        self.counts = [[bits.bit_count() for bits in column] for column in self.bits]
        self.entropy = []
        for column in self.counts:
            self.entropy.append(-sum((n / self.size) * math.log2(n / self.size) for n in column if n))
        self.entropy_order = sorted(range(self.states), key=lambda x: -self.entropy[x])
        times['statistics'] = process_time_ns() - start; start = process_time_ns()
        self.fibers = []
        for table in tables:
            values = [[] for _ in range(self.states)]
            for x, y in enumerate(table): values[y].append(x)
            self.fibers.append(tuple(tuple(xs) for xs in values))
        self.ranks = [sum(bool(xs) for xs in fibers) for fibers in self.fibers]
        self.inverses = [bytes(xs[0] for xs in fibers) if rank == self.states else None
                         for fibers, rank in zip(self.fibers, self.ranks)]
        times['fibers'] = process_time_ns() - start; start = process_time_ns()
        self.rank_masks = []
        for minimum in range(self.states + 1):
            bits = 0
            for i, rank in enumerate(self.ranks):
                if rank >= minimum: bits |= 1 << i
            self.rank_masks.append(bits)
        times['ranks'] = process_time_ns() - start
        self.component_ns = times

    def mask(self, x: int, allowed: tuple[int, ...]) -> int:
        if len(allowed) == 1: return self.bits[x][allowed[0]]
        result = 0
        column = self.bits[x]
        for value in allowed: result |= column[value]
        return result

    def candidates(self, bits: int):
        while bits:
            low = bits & -bits
            yield low.bit_length() - 1
            bits ^= low
