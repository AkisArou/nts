// `null` and `undefined` written where nothing had told them what they are.
//
// Neither has a representation of its own — the checker types `null` as `null`,
// and a compiled program needs to know whether that is a null `NtsString *` or
// a null `NtsObj_Point *`. So `lower_absent` takes the type from the context,
// and `contextual_type` is the one function that answers "what does this
// position want". Three positions were missing from it, and each was a refusal
// — ``null` or `undefined` where what it stands in for is not a reference`` —
// about a value the program *does* say the type of, one node up.
//
// # A conditional
//
// `cond ? a : null`. A conditional was in `contextual_type`'s **grouping** list,
// beside parentheses and `as`, which carries the parent's context through
// unchanged. That is wrong: a conditional has a type of its own, the union of
// its arms. `(false ? true : null) !== null` then asked the *comparison*, whose
// other side is `null`, and got nothing. It has its own arm now, beside `||`
// and `??` — the company it belongs in, an operator that picks one side and
// names no type.
//
// # A string `+`
//
// `undefined + ""` is `"undefined"` and `null + ""` is `"null"`, and `as_string`
// already emits exactly that text for an absence whose type is a string. What
// it needed was for the operand to *have* that type. Inside a `return` the
// declared result supplied it; inside `if (undefined + "" !== "undefined")`
// nothing did.
//
// # Both sides at once
//
// `null !== null` sent the two operands in a circle: each asked the other side
// of the comparison, and the other side was the other absence. It is a
// constant, decided by which absences they are and nothing else — there is no
// value to compare at run time and no type for one to have. Answered **above**
// `erased_absence_test`, which is a *tag* test on a value that was read and was
// trying to lower one of these sides to have a tag to read.

/**
 * The **condition takes the parameter**, so the differential drives both arms
 * rather than one. An arm whose answer does not depend on `n` tests a single
 * case however many inputs are pushed through it.
 */
export function aConditionalArm(n: number): number {
  const chosen = (n < 1 ? true : null) === null ? 1 : 0;
  const mirror = (n < 1 ? null : true) === null ? 1 : 0;
  return chosen * 10 + mirror;
}

/** The arm that is actually taken still works, which a fix to the type alone
 *  would not show. */
export function theTakenArm(n: number): number {
  return (n < 1 ? 3 : null) === 3 ? 1 : 0;
}

export function concatenatedAbsences(n: number): string {
  return undefined + "" + (null + "") + n.toString();
}

/** `void 0` is the other spelling of `undefined`, and it has an operand. */
export function voidInAConcatenation(n: number): string {
  return void 0 + "" + n.toString();
}

let evaluated = 0;

function bump(): number {
  evaluated = evaluated + 1;
  return 1;
}

/**
 * `void e` evaluates `e`. A lowering that folded `void` to a constant would
 * drop the call, and every other arm here would still pass.
 */
export function voidStillEvaluates(n: number): number {
  evaluated = 0;
  const text = void bump() + "";
  return evaluated * 10 + (text === "undefined" ? 1 : 0) + n * 0;
}

export function twoAbsencesCompared(n: number): number {
  const a = null !== null ? 1 : 0;
  const b = undefined !== null ? 1 : 0;
  const c = undefined === undefined ? 1 : 0;
  return a * 100 + b * 10 + c + n * 0;
}

/** Loose equality, where `null == undefined` is the one coercion in the
 *  language that holds between exactly these two values. */
export function twoAbsencesLoosely(n: number): number {
  const a = undefined == null ? 1 : 0;
  const b = undefined != null ? 1 : 0;
  return a * 10 + b + n * 0;
}

/**
 * The control: an absence compared against a **value**, which is the erased tag
 * test and must keep working. A change that answered every absence comparison
 * from the source text would pass every arm above and get this one wrong on
 * every input.
 */
export function anAbsenceAgainstAValue(n: number): number {
  const xs: number[] = n < 1 ? [] : [7];
  const popped = xs.pop() === undefined ? 1 : 0;
  const twice = xs.pop() === undefined ? 1 : 0;
  return popped * 10 + twice;
}

/** And an absence in a position that always worked: a declared slot. */
export function aDeclaredSlot(n: number): number {
  const s: string | null = n < 1 ? null : "here";
  return s === null ? 1 : 0;
}
