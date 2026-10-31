"""Independent joins over the same prefix/suffix semantic banks."""
from dataclasses import dataclass
import numpy as np
from .domains import compose
from .index import BankIndex


@dataclass(frozen=True)
class Planner:
    order: str = "entropy"
    verify_at: int = 4
    probes: int = 0
    rank_filter: bool = False
    # Optional second phase after one probe changes the survivor set.
    next_order: str = "same"
    inverse: bool = True
    image_guard: bool = False
    memo: bool = False


def pairwise(tables, target):
    for j, suffix in enumerate(tables):
        for i, prefix in enumerate(tables):
            if compose(prefix, suffix) == target: return i, j
    return None


def vectorized(index: BankIndex, target):
    expected = np.frombuffer(target, dtype=np.uint8)
    for j, suffix in enumerate(index.tables):
        lookup = np.frombuffer(suffix, dtype=np.uint8)
        matches = np.flatnonzero(np.all(lookup[index.rows] == expected, axis=1))
        if matches.size: return int(matches[0]), j
    return None


def inverse_hash(index: BankIndex, target):
    """Fast when suffixes are bijections; exact pairwise fallback otherwise."""
    for j, suffix in enumerate(index.tables):
        inverse = index.inverses[j]
        if inverse is not None:
            required = compose(target, inverse)
            i = index.exact.get(required)
            if i is not None: return i, j
        else:
            for i, prefix in enumerate(index.tables):
                if compose(prefix, suffix) == target: return i, j
    return None


def indexed(index: BankIndex, target: bytes, planner: Planner):
    rank = len(set(target)) if planner.rank_filter else 0
    outputs = tuple(set(target)) if planner.image_guard else ()
    memo = {} if planner.memo else None
    for j, suffix in enumerate(index.tables):
        if planner.inverse and index.inverses[j] is not None:
            i = index.exact.get(compose(target, index.inverses[j]))
            if i is not None: return i, j
            continue
        fibers = index.fibers[j]
        if planner.rank_filter and index.ranks[j] < rank: continue
        # Impossible target outputs are a sound, inexpensive rejection.
        if planner.image_guard and any(not fibers[y] for y in outputs): continue
        remaining = index.rank_masks[rank] if planner.rank_filter else index.all
        def mask(x):
            allowed = fibers[target[x]]
            if memo is None: return index.mask(x, allowed)
            key = (x, allowed)
            if key not in memo: memo[key] = index.mask(x, allowed)
            return memo[key]
        if planner.order == "fixed": order = range(index.states)
        elif planner.order in ("entropy", "dynamic"): order = index.entropy_order
        elif planner.order == "fiber": order = sorted(range(index.states), key=lambda x: len(fibers[target[x]]))
        elif planner.order == "selectivity":
            order = sorted(range(index.states), key=lambda x: sum(index.counts[x][v] for v in fibers[target[x]]))
        else: raise ValueError(planner.order)
        pending = list(order)
        probes = 0
        while remaining:
            if remaining.bit_count() <= planner.verify_at or not pending or (planner.probes and probes >= planner.probes):
                for i in index.candidates(remaining):
                    if compose(index.tables[i], suffix) == target: return i, j
                break
            dynamic = planner.order == "dynamic" or (probes and planner.next_order == "dynamic")
            if dynamic:
                choices = [(mask(x) & remaining, x) for x in pending]
                chosen, x = min(choices, key=lambda pair: pair[0].bit_count())
                remaining = chosen; pending.remove(x)
            else:
                if probes == 1 and planner.next_order == "selectivity":
                    pending.sort(key=lambda x: sum(index.counts[x][v] for v in fibers[target[x]]))
                x = pending.pop(0)
                remaining &= mask(x)
            probes += 1
    return None


BASELINES = {
    "pairwise": lambda index, target: pairwise(index.tables, target),
    "numpy": vectorized,
    "inverse_hash": inverse_hash,
    "bitset_fixed": lambda index, target: indexed(index, target, Planner("fixed", 0, inverse=False)),
    "bitset_entropy": lambda index, target: indexed(index, target, Planner("entropy", 4, inverse=False)),
    "bitset_selectivity": lambda index, target: indexed(index, target, Planner("selectivity", 4, inverse=False)),
    "bitset_dynamic": lambda index, target: indexed(index, target, Planner("dynamic", 4, inverse=False)),
    "hybrid": lambda index, target: indexed(index, target, Planner("entropy", 4)),
    "hybrid_rank": lambda index, target: indexed(index, target, Planner("entropy", 4, rank_filter=True)),
}
