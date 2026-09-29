// `++x` is `ToNumeric(x) + 1`, so a step *converts* before it adds, and both
// prefix and postfix go through one `step` in lowering. Before the conversion
// the addition was emitted at the checker's type for the whole expression --
// `number` -- while the operand kept its own, and a later pass made the two
// agree the only way it can, by converting a pointer or a tagged value to a
// double. Six test262 files read a number where the language says `NaN`.
//
// Every expectation here was read off node before it was written, including the
// ones that look obvious: `v++` on `"41"` is `41` and not `"41"`, because the
// specification's order is `oldValue = ToNumeric(...)` and then `return
// oldValue`, so a postfix step evaluates to the *converted* value. That was the
// second wrong answer in the same three lines.
//
// **The boundary is deliberately not here, because it is still wrong.** An
// erased operand whose type admits an *object* is handed on unconverted:
// `ToNumber` of an object is `ToPrimitive`, which runs `valueOf` and `toString`
// off a prototype chain, and `++[5]` is 6. `outcomes/an-object-incremented`
// records that, and `{}` reaches it because the empty object type is not a
// layout -- a *concrete* object (`{ a: 1 }`, `new C()`) refuses by name and
// always did. What closes it is a tag dispatch in the runtime, not a wider rule
// in `step`.

// The control: a number converts to itself, so nothing about this arm may move.
export function number(n: number): number {
  let v = n;
  return ++v;
}

// An erased operand whose type admits no object. These three are the win: the
// tag dispatch is ToNumber, and all three answered a number before.
export function undefinedPrefix(n: number): number {
  let v: undefined | number = undefined;
  // @ts-expect-error -- JavaScript converts; TypeScript will not step an `undefined`
  const stepped = ++v;
  return (Number.isNaN(stepped) ? 1 : 0) + n * 0;
}

export function undefinedDecrement(n: number): number {
  let v: undefined | number = undefined;
  // @ts-expect-error -- `--` converts by the same rule, and test262 checks both
  const stepped = --v;
  return (Number.isNaN(stepped) ? 1 : 0) + n * 0;
}

export function nullPrefix(n: number): number {
  let v: null | number = null;
  // @ts-expect-error -- `ToNumber(null)` is +0, so this is 1
  return ++v + n * 0;
}

export function stringOrBoolean(n: number): number {
  const seed: string | boolean = n > 1e308 ? true : "41";
  let v: string | boolean = seed;
  // @ts-expect-error -- `ToNumber("41")` is a parse, not a cast
  return ++v + n * 0;
}

// A postfix step evaluates to the CONVERTED old value, which is a number even
// where the operand was not. Both of these returned the raw operand before.
export function postfixIsConverted(n: number): number {
  const seed: string | boolean = n > 1e308 ? true : "41";
  let v: string | boolean = seed;
  // @ts-expect-error -- `v++` is 41, a number, and `v` is then 42
  const before = v++;
  return before + n * 0;
}

export function postfixLeavesTheStep(n: number): number {
  const seed: string | boolean = n > 1e308 ? true : "41";
  let v: string | boolean = seed;
  // @ts-expect-error -- the step still happened, so `v` holds 42
  v++;
  // The written-back value is read by stepping again, which answers 43. Reading
  // it any other way needs a cast or a comparison, and the checker does not
  // model the step's retyping: it narrows `v` back to `string | boolean`, so
  // `v as number` is TS2352 and `v === 42` is TS2367. `++v` is typed `number`
  // whatever the operand was, so this arm needs neither.
  // @ts-expect-error -- 42 + 1
  return ++v + n * 0;
}

// A concrete boolean, which worked before and must keep working: `ToNumber` of
// one is 1 or 0 and C's own conversion is that.
export function booleanPrefix(n: number): number {
  let v = true;
  // @ts-expect-error -- `++true` is 2
  return ++v + n * 0;
}

// A BigInt is the one representation the conversion must NOT touch, and not out
// of caution: `ToNumeric` keeps it a BigInt and steps by `1n`, so `++1n` is
// `2n` with `typeof === "bigint"` -- while `+1n` *throws*. Converting would
// answer 2 where the language says 2n.
// `n` reaches the *result* rather than the BigInt on purpose: `BigInt(n)` throws
// a RangeError for a fractional argument, and the pool holds fractions, so
// deriving the operand from it declines most of the cases instead of comparing
// them. A function taking no scalar argument is compared not at all, which is
// the other half of the same trap.
export function bigIntPrefix(n: number): number {
  let v = 1n;
  ++v;
  return (v === 2n ? 1 : 0) + n * 0;
}

export function bigIntPostfix(n: number): number {
  let v = 1n;
  const before = v++;
  return (before === 1n && v === 2n ? 1 : 0) + n * 0;
}

export function bigIntStaysABigInt(n: number): number {
  let v = 1n;
  ++v;
  return (typeof v === "bigint" ? 1 : 0) + n * 0;
}
