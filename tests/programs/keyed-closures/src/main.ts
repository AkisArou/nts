// Closures reached through a `Map` and a `Set`, and the layout that was not
// there to reach them with.
//
// A function type is a signature, and a signature acquires a layout from
// whatever *constructs* one -- an arrow's class names it as its base. A
// function that only receives or returns one constructs nothing, so
// `materialize` walks a signature's types and asks for the layouts they need.
// It walked *containers*: an array's element and a promise's settled value.
//
// It did not walk a map or a set, and those are the same question one level
// in. `table.get(name)` hands back a `Step`, and `for (const step of seen)`
// binds one -- so a program that reads closures out of a map it did not build
// answered `NTS2006 an object type with no layout` and stopped there. This is
// the shape shared source takes constantly: a table of handlers, populated
// somewhere else.
//
// The two halves below are deliberately different. `steps` and `seen` are
// built here, so their layouts would have been found by construction anyway
// and what they check is that reading a closure back out of a table *works*.
// `pending` and `waiting` are never populated, so nothing in this program
// constructs a `Weigh` or a `Blend` -- their layouts exist only because a
// signature mentioned them, which is the fix itself.

type Step = (value: number) => number;
type Weigh = (a: number, b: number) => number;
type Blend = (a: number, b: number, c: number) => number;

const steps = new Map<string, Step>();
steps.set("inc", (v) => v + 1);
steps.set("double", (v) => v * 2);
steps.set("negate", (v) => -v);

const names = ["inc", "double", "negate", "missing"];

// A hit and a miss over the same table, chosen by the caller. `pick` arrives
// from a pool that includes NaN and both infinities' neighbours, so the index
// is normalised before it indexes anything.
export function through(pick: number, value: number): number {
  const at = ((pick | 0) % 4 + 4) % 4;
  const step = steps.get(names[at]);
  return step === undefined ? -1 : step(value);
}

// The same table read by iteration rather than by key, which reaches the map's
// value type through a different lowering.
export function everyStep(value: number): number {
  let total = 0;
  for (const step of steps.values()) {
    total = total + step(value);
  }
  return total;
}

const seen = new Set<Step>();
seen.add((v) => v + 7);
seen.add((v) => v * 3);

export function overSet(value: number): number {
  let total = 0;
  for (const step of seen) {
    total = total + step(value);
  }
  return total;
}

// Never populated. Nothing here constructs a `Weigh`, so the only reason its
// layout exists is that this signature names a `Map` whose values are one --
// and `get` on an empty map returning `undefined` is a perfectly ordinary
// program, not a contrived one. Before the fix this line was a refusal.
const pending = new Map<string, Weigh>();

export function fromEmptyMap(a: number, b: number): number {
  const weigh = pending.get("anything");
  return weigh === undefined ? a - b : weigh(a, b);
}

// And the set half, with a third signature so the two cannot share a layout by
// accident.
const waiting = new Set<Blend>();

export function fromEmptySet(a: number, b: number): number {
  let total = a;
  for (const blend of waiting) {
    total = blend(total, b, 2);
  }
  return total;
}

// A map keyed by a signature rather than valued by one, so the *key* side of
// the walk is exercised too. The keys are never constructed here either.
const scores = new Map<Weigh, number>();

export function fromKeyedMap(a: number): number {
  let total = a;
  for (const score of scores.values()) {
    total = total + score;
  }
  return total;
}
