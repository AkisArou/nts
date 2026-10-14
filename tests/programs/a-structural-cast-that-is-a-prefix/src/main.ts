// A class reaching a slot typed by a *structural* type it satisfies.
//
// A compiled reference is a pointer, and reading it as another type is a pointer
// cast. That is free when the target's fields are the source's first fields, in
// order — which is what base-first layout gives a subclass, and what the emitter
// assumed of every pair of object types:
//
//     // in `coerce`, before this was checked
//     // "Two managed types is an upcast, which base-first layout makes a
//     //  no-op pointer cast"
//
// It is not a fact about every pair. `class Thing { id: number; name: string }`
// puts `name` at offset 32 and `interface Named { name: string }` puts it at 24,
// so a `Thing` read as a `Named` loads `id` — a `double` — as an `NtsString *`
// and dereferences it. The addon exits on SIGSEGV where node answers 6.
//
// Writing the same class as `{ name; id }` puts the two at the same offset and
// the program is correct. **Declaration order decided whether it crashed**, and
// nothing in the compiler, the gate or the examples said a word.
//
// This file is the half that must keep working: every conversion in it is a
// genuine prefix, so every one of them is the no-op the comment described.
// `blockers/a-structural-cast-that-is-not-a-prefix` is the other half.
//
// # The JVM lane refuses all of it, and that is the more useful answer
//
// Asked whether its backend handles the general case correctly, the JVM lane
// measured all four shapes: structural non-prefix refused, structural **prefix**
// refused, `implements` with a method works, `implements` with a data property
// was emitting a class file the verifier rejects — found and fixed by the
// question, in `15fbb5bc`.
//
// So the prefix case is correct on C and LLVM and not expressible there, which
// is the opposite asymmetry from the one expected. The JVM relates classes by
// *name*: coinciding offsets buy nothing when `getfield Named.name` needs the
// object to **be** a `Named` in the class hierarchy, and the only answer that
// lane has is a conversion — a copy, which is not the same object, which is the
// trade refused here for the same reason.
//
// That makes the refusal on the C side a limitation of the *language* as it is
// represented here rather than of one backend, and it is why the message does
// not say "another backend gets this right". None of them does.
//
// `implements Named, Counted` was tried on this file to make it expressible
// there and made it worse — a `VerifyError` before their fix and a refusal
// after — so the file stays structural, the JVM floor stays one below the LLVM
// ones, and the gap is named in `tooling/gate/all.sh` rather than absorbed.

interface Named {
  name: string;
}

interface Counted {
  name: string;
  count: number;
}

/** Prefix of `Named` and of `Counted`: the fields are declared in that order. */
class Prefixed {
  name: string;
  count: number;
  extra: boolean;
  constructor(n: number) {
    this.name = "prefixed";
    this.count = n;
    this.extra = n > 0;
  }
}

class Base {
  name: string;
  constructor(label: string) {
    this.name = label;
  }
}

class Derived extends Base {
  count: number;
  constructor(n: number) {
    super("derived");
    this.count = n;
  }
}

function readName(v: Named): number {
  return v.name.length;
}

function readBoth(v: Counted): number {
  return v.name.length * 100 + v.count;
}

/** One field, and it is the first one. */
export function oneFieldPrefix(n: number): number {
  return readName(new Prefixed(n)) + n;
}

/** Two fields, and they are the first two. */
export function twoFieldPrefix(n: number): number {
  return readBoth(new Prefixed(n)) + n;
}

/** The case the assumption was written for: a subclass to its base. */
export function subclassToItsBase(n: number): number {
  const b: Base = new Derived(n);
  return b.name.length + n;
}

/** A subclass reaching a structural type its base satisfies. */
export function subclassToAStructuralType(n: number): number {
  return readName(new Derived(n)) + n;
}

/** Control: the class read as itself, which no cast is involved in. */
export function withoutAConversion(n: number): number {
  const p = new Prefixed(n);
  return p.name.length * 100 + p.count + n;
}

/** Control: the object survives the call and is not a copy. */
export function theReceiverIsNotACopy(n: number): number {
  const p = new Prefixed(n);
  const seen = readBoth(p);
  return seen + p.count * 1000;
}
