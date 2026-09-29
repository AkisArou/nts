// The shapes `Program::record_parents` has to get right, and the ones it has to
// leave alone.

// One declared parent, both ends interfaces this program declares: an entry.
interface EntryJSON {
  readonly name: string;
}
export interface DetailJSON extends EntryJSON {
  readonly detail: string;
}

// Two parents: no entry. Which one a consumer would pick is the guess this
// declines to make.
interface Timed {
  readonly at: number;
}
export interface TimedDetailJSON extends EntryJSON, Timed {
  readonly extra: string;
}

// No parent: no entry.
export interface Plain {
  readonly only: string;
}

// An interface extending one whose shape it does not change: both ids land in one
// layout, because `Layout::types` merges structurally identical types. Recording
// that would be a **self-edge** -- a class extending itself, and an ancestry walk
// that does not terminate. Six runtime modules produced one before the fill moved
// to after the layouts were final.
interface SameShape {
  readonly v: number;
}
export interface AlsoSameShape extends SameShape {}

// A class extending a class is `Layout.base`'s business and must not appear
// here, or the two facts start disagreeing about the same edge.
class Base {
  n = 1;
}
export class Derived extends Base {
  m = 2;
}

// A class implementing an interface is an `implements` edge, not a declared
// parent of a record.
export class Implementer implements EntryJSON {
  readonly name = "i";
}

export function readsThem(d: DetailJSON, t: TimedDetailJSON, p: Plain): string {
  return `${d.name}${d.detail}${t.extra}${p.only}`;
}

export function readsTheSameShape(a: AlsoSameShape, s: SameShape): number {
  return a.v + s.v;
}

export function widens(d: DetailJSON): EntryJSON {
  return d;
}

export function usesTheClasses(): number {
  const d = new Derived();
  const i = new Implementer();
  return d.n + d.m + i.name.length;
}
