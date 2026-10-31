"""Opaque finite operation families; goal words never reach the solver."""
from dataclasses import dataclass
from collections import deque
import random


@dataclass(frozen=True)
class Domain:
    family: str
    seed: int
    states: int
    actions: tuple[bytes, ...]


def compose(prefix: bytes, suffix: bytes) -> bytes:
    """Run prefix, then suffix. bytes.translate performs the full exact table."""
    return prefix.translate(suffix + bytes(256 - len(suffix)))


def domain(family: str, seed: int, states: int, actions: int) -> Domain:
    if states < 4 or states > 256 or states & (states - 1):
        raise ValueError("states must be a power of two in [4,256]")
    rng = random.Random(seed)
    tables = []
    while len(tables) < actions:
        if family == "permutation":
            values = list(range(states)); rng.shuffle(values)
        elif family == "affine":
            a = rng.randrange(1, states); b = rng.randrange(states)
            values = [(a * x + b) % states for x in range(states)]
        elif family == "bitvector":
            mode = rng.randrange(5); c = rng.randrange(1, states)
            bits = states.bit_length() - 1
            if mode == 0: values = [x ^ c for x in range(states)]
            elif mode == 1: values = [(x + c) % states for x in range(states)]
            elif mode == 2: values = [((x << 1) | (x >> (bits - 1))) & (states - 1) for x in range(states)]
            elif mode == 3: values = [x & c for x in range(states)]
            else: values = [(x >> 1) ^ c for x in range(states)]
        elif family == "automaton":
            # Random but high-rank enough to avoid all long words collapsing.
            values = list(range(states)); rng.shuffle(values)
            for _ in range(max(1, states // 8)):
                values[rng.randrange(states)] = rng.randrange(states)
        elif family == "local":
            # Unseen, highly correlated coordinates: most actions leave most states alone.
            values = list(range(states))
            block = rng.sample(range(states), max(3, states // 4))
            shifted = block[1:] + block[:1]
            for x, y in zip(block, shifted): values[x] = y
            if rng.random() < 0.4: values[block[0]] = values[block[1]]
        else:
            raise ValueError(family)
        table = bytes(values)
        if table not in tables: tables.append(table)
    rng.shuffle(tables)
    return Domain(family, seed, states, tuple(tables))


def bank(d: Domain, depth: int) -> tuple[list[bytes], list[tuple[int, ...]]]:
    identity = bytes(range(d.states))
    tables = [identity]; words = [()]; seen = {identity}; queue = deque([0])
    while queue:
        i = queue.popleft()
        if len(words[i]) == depth: continue
        for action, table in enumerate(d.actions):
            result = compose(tables[i], table)
            if result not in seen:
                seen.add(result); tables.append(result); words.append(words[i] + (action,)); queue.append(len(tables) - 1)
    return tables, words


def goals(d: Domain, depth: int, count: int, exclude=()) -> list[bytes]:
    rng = random.Random(d.seed ^ 0x5EED)
    result = []; seen = set(exclude)
    for _ in range(count * 100):
        word = [rng.randrange(len(d.actions)) for _ in range(2 * depth)]
        table = bytes(range(d.states))
        for action in word: table = compose(table, d.actions[action])
        if table not in seen:
            seen.add(table); result.append(table)
        if len(result) == count: return result
    return result  # Saturation is reported explicitly by the runner.


def verify(d: Domain, prefix_word: tuple[int, ...], suffix_word: tuple[int, ...], target: bytes) -> bool:
    value = bytes(range(d.states))
    for action in prefix_word + suffix_word: value = compose(value, d.actions[action])
    return value == target
