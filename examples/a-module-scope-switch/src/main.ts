// A `switch` at module scope whose clauses assign a module-scope name.
//
// This **panicked the compiler**:
//
//     thread 'main' panicked at compiler/core/src/hir/lower.rs:
//     no entry found for key
//
// `lower_switch` collects the names its clauses assign and gives each one a
// block parameter per clause, then reads their current values with
// `carried_now` — which indexes the binding table. At module scope those names
// are *globals*, and a global is not in it.
//
// A global is memory: read with `GlobalGet`, written with `GlobalSet`. A clause
// that assigns one needs no block parameter at all, because the next reader
// reads the slot the last writer wrote. `begin_loop` has applied exactly that
// rule to a loop's carried set since the day a loop assigning a global was
// fixed; `lower_switch` never did.
//
// # Why it was a panic and not a refusal
//
// `emit-c` died rather than refusing, so there was no diagnostic, no artifact,
// and nothing naming the construct. An instrument reading the exit status sees
// a build failure indistinguishable from a toolchain problem — the probe that
// found this reported `C DID NOT COMPILE`, because the output directory was
// simply absent and the runner had no arm for "the compiler did not survive".
//
// A symbol that is neither bound nor a global is now refused **by name** rather
// than indexed, which is what `begin_loop` does one line further on.
//
// # And the comment that caused it
//
// `assigned_symbols` said "a global is skipped here rather than at each of the
// seven call sites". It is not, and never was — the filtering is done by the
// *consumers*, deliberately, because a `for (let i = 0; …)` head at module
// scope is collected as a module binding and filtering it early stopped `i`
// being carried at all. `lower_switch` was written trusting the comment.

const first: number = 2;
let assigned = 0;
switch (first) {
  case 1:
    assigned = 1;
    break;
  case 2:
    assigned = 2;
    break;
  default:
    assigned = 9;
}

// Fall-through, so a clause that does not `break` reaches the next one. The
// sums are distinct per path, which is what makes a wrong thread visible.
const second: number = 1;
let fallen = 0;
switch (second) {
  case 1:
    fallen = fallen + 1;
  // falls through
  case 2:
    fallen = fallen + 10;
    break;
  default:
    fallen = 100;
}

// `default` reached because nothing matched, and written where it is rather
// than where it would be if `default` took part in the test order.
const third: number = 9;
let defaulted = 0;
switch (third) {
  case 1:
    defaulted = 1;
    break;
  default:
    defaulted = 5;
}

// A clause with a *local* beside the global: one is carried and the other is
// not, in the same switch, which is the case a filter that took all or nothing
// would get wrong.
const fourth: number = 1;
let mixed = 0;
switch (fourth) {
  case 1: {
    const local = 5;
    mixed = local;
    break;
  }
  default:
    mixed = 9;
}

export function readAssigned(): number {
  return assigned;
}

export function readFallen(): number {
  return fallen;
}

export function readDefaulted(): number {
  return defaulted;
}

export function readMixed(): number {
  return mixed;
}

// **The control.** The same construct inside a function, where the names are
// locals and the carried set is exactly what it was designed for. It has always
// worked, and it passes on the compiler that panicked on everything above.
export function inAFunction(k: number): number {
  let r = 0;
  switch (k) {
    case 1:
      r = 1;
      break;
    case 2:
      r = 2;
      break;
    default:
      r = 9;
  }
  return r;
}
