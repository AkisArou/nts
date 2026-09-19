// A module-scope `let x: number | undefined`, read where the checker has
// narrowed it.
//
//     let x: number | undefined = undefined;
//     x ??= 5;
//     const settled: number = x;   // refused at module scope, fine in a function
//
//     NTS1001 an erased value where a concrete representation is wanted
//
// `number | undefined` has no spare bit — a number cannot be null — so it is
// stored **erased**, a tag beside a payload. Reading one as a `number` needs an
// unerase, and `narrowed` is the function that inserts it: it compares the
// value's representation against `type_of` at the read and unwraps when the
// checker has established something narrower.
//
// Three places read a name, and only two of them called it. The local-binding
// branch at the top of `lower_identifier` narrowed; the branch for a *global
// member* narrowed; the branch for a plain module-scope global returned the
// slot's declared representation whatever the checker had established. So the
// same three lines were an ordinary local inside a function and refused one
// scope out — which is the shape `an-evolving-type-at-module-scope` carries for
// the *type* of such a global, and this is the same question about its *value*.
//
// # Why `string | undefined` was not the case that found it
//
// `joined` below is the control, and it lowered before this. A string is a
// reference, so `string | undefined` is a nullable pointer rather than an erased
// pair: there is nothing to unerase, so the missing call could not be observed
// through it. Only the representations that erase — `number | undefined`,
// `boolean | undefined`, `number | null` — reach the refusal, which is why a
// sweep over one of them would have said the feature worked.
//
// # `??=` rather than `||=`, deliberately
//
// `keepsZero` and `keepsFalse` are the arms that make this a test of `??`
// rather than of truthiness. `0 ??= 5` is `0` and `false ??= true` is `false`;
// both would be `5` and `true` under `||=`, and both are values a program
// legitimately holds. `examples/nullish` owns that distinction for the operator
// itself — these two are here so that fixing a *narrowing* cannot quietly
// change which operator is being run.

let count: number | undefined = undefined;
count ??= 5;
const settledCount: number = count;

export function readCount(n: number): number {
  return settledCount * n;
}

// `0` is not nullish, so `??=` keeps it. Under `||=` this would be 5.
let zero: number | undefined = 0;
zero ??= 5;
const settledZero: number = zero;

export function keepsZero(n: number): number {
  return settledZero + n;
}

// The same, one representation over: `false` is not nullish either.
let flag: boolean | undefined = false;
flag ??= true;
const settledFlag: boolean = flag;

export function keepsFalse(n: number): number {
  return (settledFlag ? 100 : 1) * n;
}

// `null` rather than `undefined`, which is the other half of the absence.
let slot: number | null = null;
slot ??= 9;
const settledSlot: number = slot;

export function readSlot(n: number): number {
  return settledSlot * n;
}

// Narrowed by a test rather than by an operator, so the proof is the checker's
// control flow rather than one expression.
let tested: number | undefined = undefined;
if (tested === undefined) {
  tested = 7;
}
const settledTested: number = tested;

export function readTested(n: number): number {
  return settledTested + n;
}

// **Control.** A reference, whose absence is a null pointer rather than a tag.
// This lowered on the compiler that refused every arm above.
let joined: string | undefined = undefined;
joined ??= "ab";
const settledJoined: string = joined;

export function readJoined(n: number): number {
  return settledJoined.length * n;
}

// **Control.** The same shape one scope in, which has always worked — the
// binding branch of `lower_identifier` narrows, and did before this.
export function inAFunction(n: number): number {
  let local: number | undefined = undefined;
  local ??= 5;
  return local * n;
}
