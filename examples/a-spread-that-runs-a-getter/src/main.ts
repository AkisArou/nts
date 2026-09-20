// `{ ...src }` where `src` has a getter, which compiled, ran, and answered the
// slot's zero.
//
// `spread_into` copies **fields**, and a `Layout` holds storage. An accessor is
// a call rather than storage --- `Accessor`'s own documentation says emitting a
// field load for one "reads whatever happens to sit at that offset" --- so the
// layout has no entry for `get a()` at all. The walk did not skip it so much as
// never meet it: the source's fields were copied, `a` was not one of them, and
// the target's `a` kept the zero it was allocated with.
//
// Two things were wrong and only one of them is a number:
//
//     copy.a          0        node says 1
//     times the getter ran     0        node says 1
//
// The second is the one that matters for any getter that does something. A
// spread dropped the call entirely, so a side effect the program depended on
// simply did not happen, and nothing anywhere said so.
//
// # Why this was invisible
//
// A refusal would have named it. This compiled on every backend and agreed with
// itself, because the wrong value was *consistently* wrong --- the zero is what
// the slot holds, so C, LLVM and the JVM all read the same zero out of it.
// Found by a sweep of ten object-construction shapes against node, which is the
// only instrument here that can see a program that runs and is wrong.
//
// Pre-existing: a binary built 2026-09-18 answers identically.
//
// # The shape of the fix
//
// The field walk is unchanged. A second pass asks, for each target slot the
// walk did *not* fill, whether the **source's type** declares that name as a
// getter, and emits the call if it does. Asking against the source is what
// keeps `{ ...src, a: 5 }` working: `a` is written by the literal, the literal's
// own property writes it afterwards, and the source is consulted only for names
// the spread is responsible for.
//
// The arms below are the ones that must keep holding, and `aGetterAndAFieldTogether`
// and `theOrderTwoGettersRunIn` are the two that would have passed on the broken
// compiler had they only checked the *value*.

let getterRuns = 0;
const withAGetter = {
  get computed(): number {
    getterRuns += 1;
    return 1;
  },
  plain: 2,
};
const copied = { ...withAGetter };

let order = "";
const twoGetters = {
  get first(): number {
    order += "f";
    return 1;
  },
  get second(): number {
    order += "s";
    return 2;
  },
};
const bothCopied = { ...twoGetters };

const overridden = { ...withAGetter, plain: 9 };

const left = { x: 1 };
const right = { y: 2 };
const merged = { ...left, ...right };

export function theGetterRanExactlyOnce(): number {
  return getterRuns;
}

export function theCopyHoldsWhatTheGetterReturned(): number {
  return copied.computed;
}

export function aGetterAndAFieldTogether(n: number): number {
  return copied.computed * 100 + copied.plain * 10 + n;
}

export function theOrderTwoGettersRunIn(): string {
  return order + bothCopied.first + bothCopied.second;
}

export function aLiteralPropertyStillWinsOverTheSpread(): number {
  return overridden.plain;
}

export function twoSpreadsStillMerge(n: number): number {
  return merged.x * 100 + merged.y * 10 + n;
}

export function readingTheCopyDoesNotRunItAgain(): number {
  const before = getterRuns;
  const seen = copied.computed;
  return (getterRuns - before) * 10 + seen;
}
