export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export type ProgramState = Readonly<Record<string, JsonValue>>;

/** Isolated, deeply frozen JSON snapshots at every primitive boundary. */
export function snapshot<S extends ProgramState>(state: S): S {
  const active = new Set<object>();
  const copy = (value: unknown, depth: number): JsonValue => {
    if (depth > 64) throw new Error('State nesting exceeds 64 levels');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || value === null)
      throw new Error('State must contain only JSON values');
    if (active.has(value)) throw new Error('Cyclic state is not supported');
    active.add(value);
    let result: JsonValue;
    if (Array.isArray(value)) {
      // Array.from also visits holes rather than silently changing them to null.
      result = Object.freeze(Array.from(value, (item) => copy(item, depth + 1)));
    } else {
      if (
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      ) {
        throw new Error('State objects must be plain JSON objects');
      }
      result = Object.freeze(
        Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, copy((value as Record<string, unknown>)[key], depth + 1)]),
        ),
      );
    }
    active.delete(value);
    return result;
  };
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('State must be a JSON object');
  }
  return copy(state, 0) as S;
}

export function sameState<S extends ProgramState>(left: S, right: S): boolean {
  return JSON.stringify(snapshot(left)) === JSON.stringify(snapshot(right));
}
