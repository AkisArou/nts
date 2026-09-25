// `typeof` on a value whose type is a type parameter: the comparison is decided
// by the copy, and the arm it decides against is not lowered.
//
// **Without this the program did not compile at all** -- not "refused", *invalid
// HIR*, which costs the whole program rather than one function:
//
//     OperandsDiffer { func: "width<str>", op: "*", left: Managed(String),
//                      right: Float { bits: 64 } }
//
// A copy knows what its type parameter binds, so `typeof held` in `width<str>`
// lowers to the constant `"string"`. The comparison against `"number"` beside it
// was left as a runtime `eq` of two constants, and the arm behind it was lowered
// as written -- `held * 2` on a string pointer. `verify` caught it, which is the
// good direction, and then `emit-c` refused `widthOfNumber` too because a program
// that does not verify emits nothing.
//
// `lower::statically_decided` cannot see this and should not be asked to: it
// reads the **checker's** type for the condition, and the checker is typing the
// declaration, where `S` may perfectly well be a number. The fact only exists
// after a copy has substituted, which is after lowering -- so the decision is a
// pass, `fold::decided_branches`, running just before the block pruning that
// removes the arm and the value elimination that removes what was in it.
//
// # What each export earns
//
//     widthOfNumber   the copy decides the comparison *true*: one arm, no branch
//     widthOfText     the copy decides it *false*, which is the arm that was
//                     invalid -- this export is the whole reason the file exists
//     notTextNumber   `!==`, so the `Ne` half is not taken on trust
//     notTextText     and its other answer
//     eitherNumber    **the control.** `typeof value === "string"` where
//                     `value: S | string` and `S` is `number` is *not* decidable:
//                     both arms are live in that one copy and both must survive.
//                     If the fold were keyed on the operator rather than on the
//                     operands being constants, this one would disagree with node.
//     eitherText      and the same call where `S` *is* `string`, so the union
//                     collapses and the copy decides it true -- the pair is what
//                     says the fold is about the operands and not the shape.
//
// The control was written with `((previous: S) => S) | S` first, which is React's
// `basicStateReducer` and the shape every hook in that runtime writes. It is not
// here because **it does not agree on the JVM today, and did not before this
// commit either**: a closure erased into that union and called after the narrowing
// is unerased to the signature class rather than to the closure's own, and
// `nts.gen.Closure0 cannot be cast to nts.gen.Fn2__2` is thrown. C and LLVM spell
// every reference one way and agree with node by luck. That is a separate defect,
// reported with its reduction, and putting it in this example would have made this
// fixture measure two things and land neither.

function width<S>(value: S): number {
  const held: S = value;
  return typeof held === "number" ? held * 2 : 0;
}

function notText<S>(value: S, fallback: number): number {
  const held: S = value;
  return typeof held !== "string" ? fallback + 1 : fallback - 1;
}

/** **Control.** A `typeof` no copy can decide: both arms are live in one copy. */
function either<S>(value: S | string, fallback: number): number {
  return typeof value === "string" ? fallback + 1 : fallback - 1;
}

export function widthOfNumber(n: number): number {
  return width(n);
}

export function widthOfText(word: string): number {
  return width(word);
}

export function notTextNumber(n: number): number {
  return notText(n, n);
}

export function notTextText(word: string): number {
  return notText(word, word.length);
}

export function eitherNumber(n: number): number {
  return either(n, n);
}

export function eitherText(word: string): number {
  return either(word, word.length);
}
