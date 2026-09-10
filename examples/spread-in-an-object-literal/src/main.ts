// `{ ...base, k: v }` in an object literal.
//
// Refused, by name, since object literals were written: `a `spread assignment`
// in an object literal`. 25 distinct sites across `runtime/node` and
// `runtime/web-platform` and 158 refused functions across the module builds —
// `util/inspect.ts`, `stream/from.ts`, `util/format.ts`, `fs/src/options.ts`.
// It is how a TypeScript program spells "these options, with this one changed".
//
// It is a field-by-field copy, and the whole of the semantics falls out of
// emitting it **where it is written**: what comes later overwrites what came
// before. A lowering that appended the spread's stores at the end would pass
// `{ ...base, count: 7 }` and fail `{ ...first, ...second }`, so both are here.
//
// The third order — a named property *before* a spread that also has it — cannot
// be written: TypeScript rejects `{ count: 7, ...base(n) }` as TS2783, "specified
// more than once, so this usage will be overwritten". So the ordering this
// fixture can check is spread-against-spread, and it checks it.
//
// Only from a value with a layout. A spread of an erased value or of a table has
// no field list to walk, and that refuses rather than guessing one.

interface Options {
  count: number;
  label: string;
  on: boolean;
}

interface Narrow {
  count: number;
}

class Holder {
  count: number;
  label: string;
  on: boolean;
  constructor(n: number) {
    this.count = n;
    this.label = "held";
    this.on = n > 0;
  }
}

function base(n: number): Options {
  return { count: n, label: "base", on: n > 0 };
}

/** The spelling everybody writes: spread first, then the override. */
export function overrideAfterTheSpread(n: number): number {
  const merged: Options = { ...base(n), count: 7 };
  return merged.count * 10 + merged.label.length + (merged.on ? 100 : 0);
}

/** Two spreads, where the later one wins field by field. */
export function twoSpreads(n: number): number {
  const first: Options = { count: 1, label: "first", on: false };
  const second: Options = { count: n, label: "se", on: true };
  const merged: Options = { ...first, ...second };
  return merged.count * 10 + merged.label.length + (merged.on ? 100 : 0);
}

/** A spread of a class instance, whose layout comes from a declaration. */
export function spreadOfAnInstance(n: number): number {
  const merged: Options = { ...new Holder(n), label: "over" };
  return merged.count * 10 + merged.label.length + (merged.on ? 100 : 0);
}

/**
 * A source with fields the target does not have. The extra ones are not in the
 * result's type, so nothing can read them back and nothing is copied.
 */
export function spreadIntoANarrowerType(n: number): number {
  const narrow: Narrow = { ...base(n) };
  return narrow.count + 1;
}

/** A spread of a narrower source, where the rest of the target is written out. */
export function spreadOfANarrowerSource(n: number): number {
  const narrow: Narrow = { count: n };
  const merged: Options = { ...narrow, label: "wide", on: true };
  return merged.count * 10 + merged.label.length + (merged.on ? 100 : 0);
}

/** The string field alone, so a reference field's copy is its own case. */
export function theReferenceField(n: number): number {
  const merged: Options = { ...base(n), label: n > 0 ? "positive" : "not" };
  return merged.label.length;
}

/** Control: the same shape with no spread, which was always right. */
export function withoutASpread(n: number): number {
  const merged: Options = { count: 7, label: "base", on: n > 0 };
  return merged.count * 10 + merged.label.length + (merged.on ? 100 : 0);
}

/** Control: the source is not disturbed by being spread. */
export function theSourceSurvives(n: number): number {
  const source = base(n);
  const merged: Options = { ...source, count: 7 };
  return source.count * 1000 + merged.count;
}
