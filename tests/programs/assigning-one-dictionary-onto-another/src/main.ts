// `Object.assign(target, source)` where both are dictionaries.
//
// A table's entries are not known at compile time, so this is the runtime's loop
// rather than a sequence of stores -- unlike `Object.keys`, whose answer for a
// *struct* is a static list of names. `nts_map_extend` is that loop, and it is
// `nts_map_copy`'s against a table that already exists, which is the whole
// difference between a spread and an assign.
//
// React's `cloneElement`, its class state merge and its props resolution are all
// this shape: 6 root refusals in that runtime.
//
// **A struct on either side is refused by name.** Its fields would be a static
// list and its slots fixed, so that case is a sequence of `FieldSet`s and not
// this walk -- a different piece of work, whose refusal this one should not
// borrow.

type Props = { [key: string]: unknown };

/** The reported shape: an entry from the source, read back off the target. */
export function copiesAnEntry(n: number): number {
  const target: Props = { a: n };
  const source: Props = { b: n + 1 };
  Object.assign(target, source);
  const b = target["b"];
  return typeof b === "number" ? b : -1;
}

/**
 * **A later entry wins**, which is the order `Object.assign` specifies. A loop
 * written the other way round passes `copiesAnEntry` and fails this.
 */
export function theSourceOverwrites(n: number): number {
  const target: Props = { a: n, shared: 1 };
  const source: Props = { shared: n + 7 };
  Object.assign(target, source);
  const shared = target["shared"];
  return typeof shared === "number" ? shared : -1;
}

/**
 * **The result is the target itself**, not a copy: `Object.assign` answers the
 * object it wrote into. A helper that allocated -- `nts_map_copy` with the
 * arguments the other way round, say -- would pass both cases above and fail
 * this one, because the write would land somewhere the caller cannot see.
 */
export function answersTheTargetItself(n: number): number {
  const target: Props = {};
  const merged = Object.assign(target, { a: n } as Props);
  target["b"] = n + 1;
  const b = merged["b"];
  return typeof b === "number" ? b : -1;
}

/**
 * The control that the source is left alone: `assign` reads it and must not
 * move its entries out.
 */
export function theSourceSurvives(n: number): number {
  const target: Props = {};
  const source: Props = { a: n };
  Object.assign(target, source);
  const still = source["a"];
  return typeof still === "number" ? still : -1;
}

/**
 * **Three sources, folded left to right**, which is React's one canonical state
 * merge: `Object.assign({}, prevState, partialState)`. The last source wins over
 * the middle one, so a fold written the other way round passes every two-source
 * case above and fails this.
 */
export function threeSourcesFoldLeftToRight(n: number): number {
  const prev: Props = { count: n, kept: 1 };
  const partial: Props = { count: n + 10 };
  const merged = Object.assign({} as Props, prev, partial);
  const count = merged["count"];
  const kept = merged["kept"];
  return typeof count === "number" && typeof kept === "number" ? count + kept : -1;
}

function readsWhatTheTargetHolds(target: Props, absent: number): Props {
  const a = target["a"];
  return { seen: typeof a === "number" ? a : absent };
}

/**
 * **Every source is evaluated before the first merge**, because that is what a
 * call does with its arguments. This source reads the target while it runs: the
 * arguments are evaluated first, so it sees nothing and answers `absent`. A
 * lowering that merged each source as it lowered it would have already written
 * `a`, and this returns `n` instead of `-1`.
 */
export function everySourceIsEvaluatedFirst(n: number): number {
  const target: Props = {};
  const merged = Object.assign(
    target,
    { a: n } as Props,
    readsWhatTheTargetHolds(target, -1),
  );
  const seen = merged["seen"];
  return typeof seen === "number" ? seen : -2;
}
