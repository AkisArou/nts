// A module-scope `const` bound to a boolean literal, read where a `boolean` is
// wanted.
//
// **This did not compile at all, and not as a refusal: it was invalid HIR**, which
// costs the whole program rather than one function.
//
//     CallArgumentType { callee: "pick", at: 0, expected: Bool, found: Float }
//
// `constant_value` folds `true` to `1.0`, which is right -- *"a boolean's storage is
// its truth value"* -- and a **global** keeps the type beside it in `Global::ty`. The
// inlined-constant read did not: every folded module-scope constant was materialised
// as `ConstFloat` at `HirType::NUMBER`, whatever the name's declared type. So a
// `boolean` parameter received an `f64` and the verifier refused the program.
//
// `pick(true)` -- the literal, unfolded -- verified, which is the control that says
// the fold rather than the boolean was at fault.
//
// Reported by the React lane, where it stopped their native probe emitting anything:
// one folded flag took out every function beside it. With it and one other
// invalid-HIR defect worked around, that probe emits again.
//
// # What each export earns
//
//     direct       the argument at a plain call, both truth values
//     virtualCall  through a method, where the parameter arrives at a vtable slot
//     inLoop       inside a loop, where the constant is read once per iteration and
//                  the fold is what makes that free
//     imported     the `const` in another module, which is how a real `__DEV__`
//                  flag arrives -- and the arm whose symbol is declared by an import
//                  specifier rather than by the variable
//
// Both truth values in every arm that can take them: a fix that materialised the
// right *type* and the wrong *value* would pass a `true`-only fixture, and `false`
// folds to the zero this file is named for.

import { enabled } from "./flags.ts";

const flag = true;
const off = false;

function pick(p: boolean): number {
  return p ? 1 : 2;
}

class Base {
  pick(p: boolean): number {
    return p ? 10 : 20;
  }
}

export function direct(n: number): number {
  return pick(flag) + pick(off) + n;
}

export function virtualCall(n: number): number {
  const b = new Base();
  return b.pick(flag) + b.pick(off) + n;
}

export function inLoop(n: number): number {
  let total = 0;
  for (let i = 0; i < 3; i++) {
    total += pick(flag);
  }
  return total + n;
}

export function imported(n: number): number {
  return pick(enabled) + n;
}
