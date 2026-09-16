// Legal TypeScript that this backend refuses by name.
//
// Every refusal here was reachable and had no producer: `NTS4013` is quoted in
// `benches/jvm-rows.md`, which is a corpus log, and its own comment in `lib.rs`
// says the shape "has never occurred outside the test that found it" -- a test
// that is not in the tree. A refusal nobody produces is a branch nobody has
// watched fire, and the failure it guards against is a class the JVM rejects at
// load with `ClassFormatError: Duplicate field name`.

/// Two properties that are different in TypeScript and the same on the JVM.
///
/// `jvm_member_name` maps every non-alphanumeric ASCII character to `$`, so a
/// space and a hyphen both become one. Four lines of legal TypeScript, and the
/// class would not load.
export class Collides {
  "a b": number = 1;
  "a-b": number = 2;
}

export function reach(it: Collides): number {
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
