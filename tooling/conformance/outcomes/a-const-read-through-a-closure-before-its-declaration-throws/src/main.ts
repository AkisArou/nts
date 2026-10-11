// **A read in the temporal dead zone stops the program instead of throwing.**
// A closure reads `x` before `const x = 1` has run; JavaScript throws a
// ReferenceError the `try` catches, so node observes `ReferenceError` and then
// the read after the declaration. nts checks the cell's `ready` flag
// (`cell.ready`) and, finding it false, stops by name: "nts: `x` was read
// before its declaration ran" -- no handler runs and nothing is observed.
//
// Until 542c4ad3c this was a wrong answer on C and LLVM, not a stop: the cell
// was frame-allocated and only its header written, so `ready` was stack
// garbage -- nonzero on almost every run, reading an uninitialised `value` (a
// different number each run), and zero now and then (the abort that looked
// like a flake in test262 and in a-hoisted-var-read-through-a-closure). The
// JVM, whose objects are zero-initialised, always stopped by name.
//
// The control is the same read after the declaration, which agrees.
//
// Pinned on 2026-10-11 by the JVM lane once the stop was deterministic.

function kind(e: unknown): string {
  return e instanceof ReferenceError ? "ReferenceError" : "other";
}

function before(): string {
  function f(): number {
    return x + 1;
  }
  let out = "";
  try {
    out = "no throw " + String(f());
  } catch (e) {
    out = kind(e);
  }
  const x = 1;
  return out + " / after " + String(f());
}

function afterOnly(): string {
  const y = 1;
  function g(): number {
    return y + 1;
  }
  return "after " + String(g());
}

observe("read after the declaration", afterOnly());
observe("read before the declaration", before());
done();
