// Legal TypeScript that this backend refuses by name.
//
// Every refusal here was reachable and had no producer: `NTS4013` is quoted in
// `benches/jvm-rows.md`, which is a corpus log, and its own comment in `lib.rs`
// says the shape "has never occurred outside the test that found it" -- a test
// that is not in the tree. A refusal nobody produces is a branch nobody has
// watched fire, and the failure it guards against is a class the JVM rejects at
// load with `ClassFormatError: Duplicate field name`.

/// Properties that are different in TypeScript and the same on the JVM.
///
/// `jvm_member_name` maps every non-alphanumeric ASCII character to `$`, so a
/// space and a hyphen both become one. Since `hierarchy::field_name` took C's
/// rule, the second of a spelling takes its slot index -- `a$b_1` -- so two
/// such properties load (`Spelled`, the control). A third *named* `a$b_1` is
/// the collision that rule cannot resolve, and the class would not load.
export class Collides {
  "a b": number = 1;
  "a-b": number = 2;
  "a$b_1": number = 3;
}

export function reach(it: Collides): number {
  return it["a b"] + it["a-b"] + it["a$b_1"];
}

export class Spelled {
  "a b": number = 1;
  "a-b": number = 2;
}

export function reachSpelled(it: Spelled): number {
  return it["a b"] + it["a-b"];
}

/// An interface that carries state, dispatched through.
///
/// **Ordinary TypeScript with no JVM spelling.** `Stateful` has a property, so
/// it cannot be a JVM interface -- one has no instance fields -- and `implements`
/// is not `extends`, so nothing relates `First` to it. Reading an erased `First`
/// back as a `Stateful` is a `checkcast` that throws.
///
/// It reached that cast and threw for as long as the backend has existed. The
/// refusal exists because a `ClassCastException` at run time is a **wrong
/// answer**: nothing in the refusal counts can see it, and it took an example
/// that dispatches through an interface type to surface it at all.
interface Stateful {
  seen: number;
  step(): void;
}

class First implements Stateful {
  seen = 0;
  step(): void {
    this.seen += 1;
  }
}

class Second implements Stateful {
  seen = 100;
  step(): void {
    this.seen += 2;
  }
}

export function dispatchThrough(n: number): number {
  const it: Stateful = (n & 1) === 0 ? new First() : new Second();
  it.step();
  return it.seen;
}

// Stateful literal contracts in arrays and boxed containers.
interface Sink { take(x: number): number; }
const own: Sink = { take: (x: number): number => x - 3 };
function fresh() { return { take: (x: number): number => x + 1 }; }
function first(all: Sink[], n: number): number { return all[0].take(n); }
export function literal(n: number): number { const a = fresh(); const all: Sink[] = [a, own]; return first(all, n); }
export function index(n: number): number { const all: Sink[] = [own]; all[0] = fresh(); return first(all, n); }
export function push(n: number): number { const all: Sink[] = [own]; all.push(fresh()); return all[1].take(n); }
export function unshift(n: number): number { const all: Sink[] = [own]; all.unshift(fresh()); return first(all, n); }
export function fill(n: number): number { const all: Sink[] = [own]; all.fill(fresh()); return first(all, n); }
export function concat(n: number): number { const all: Sink[] = [own]; const other = [fresh()]; return all.concat(other)[1].take(n); }
export function map(n: number): number { const all = new Map<string, Sink>(); all.set("own", own); all.set("value", fresh()); const got = all.get("value"); return got ? got.take(n) : 0; }
export function set(n: number): number { const all = new Set<Sink>(); all.add(own); all.add(fresh()); let result = 0; for (const got of all) result += got.take(n); return result; }
export async function promise(n: number): Promise<number> { const got: Sink = await Promise.resolve<Sink>(fresh()); return got.take(n) + own.take(n); }
