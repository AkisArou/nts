// `"k" in v` where `v` is typed `object` and some type declares `k` optionally.
//
// This is the whole-program candidate walk, not the receiver's own type: with
// `v` typed `object`, an instance of *any* type in the program can reach the
// test, so the answer is built from every type that declares the key. A type
// declaring it **optionally** used to make the whole question unanswerable —
// including it answers true for a property never written, excluding it answers
// false for one that was.
//
// Both halves are still true and the conclusion no longer follows. The object
// header records whether an optional property was written, so such a type
// contributes `is it a C` **and** `is C's bit set`. The class test was already
// being emitted for the types that declare it always; this is that test with a
// second conjunct.
//
// # Why the test is a plain `and`
//
// `nts_presence_has_value` answers false for anything that is not a reference,
// so the arm that failed the class test cannot fault in the second conjunct.
// That is what lets this be two tests joined rather than a short circuit the
// backend would have to build blocks for.
//
// # The trap this was written to catch
//
// The arms have to agree about which types exist. Deciding whether to emit a
// presence arm with a *non-creating* layout lookup, while the class test beside
// it calls `layout_of` — which **creates** — makes them disagree: an interface
// whose layout had not been built when `has` was lowered lost its arm entirely,
// and `"port" in given` answered false for an object that had one, with nothing
// emitted to say so. `optionalWritten` is the case that fails then.

interface Opts {
  keep: number;
  port?: number;
  label?: string;
}

class Fixed {
  port: number;
  constructor(n: number) {
    this.port = n;
  }
}

class Neither {
  other: number;
  constructor(n: number) {
    this.other = n;
  }
}

// `object` and nothing narrower, which is the shape every duck-typing site in
// the profile is written in.
function hasPort(given: object): number {
  return "port" in given ? 1 : 0;
}

function hasLabel(given: object): number {
  return "label" in given ? 1 : 0;
}

// Written: the bit is set and the answer is true.
export function optionalWritten(n: number): number {
  const o: Opts = { keep: n, port: n };
  return hasPort(o);
}

// Omitted: the slot is there and the bit is not.
export function optionalOmitted(n: number): number {
  const o: Opts = { keep: n };
  return hasPort(o);
}

// Written as `undefined`, which is the distinction a slot cannot make: the
// value read back is identical to the case above and the answer is not.
export function optionalWrittenAsUndefined(n: number): number {
  const o: Opts = { keep: n, port: undefined };
  return hasPort(o);
}

// A second optional property on the same type, so a wrong bit index shows up as
// an answer about the other one rather than as a crash.
export function theOtherOptional(n: number): number {
  const o: Opts = { keep: n, port: n };
  return hasLabel(o) * 10 + hasPort(o);
}

// A type that declares it *always*: answered by the class test alone, with no
// bit and no runtime call.
export function alwaysDeclared(n: number): number {
  return hasPort(new Fixed(n));
}

// A type that does not declare it at all.
export function declaresItNot(n: number): number {
  return hasPort(new Neither(n));
}
