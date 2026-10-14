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

// # The same cause, still wrong in four more places
//
// A spread was one consumer of "walk the layout's fields". **Enumeration is
// four more, and all four still omit an accessor entirely:**
//
//     const src = { get a(): number { return 1; }, b: 2 };
//
//     Object.keys(src)            "b"    node "a,b"
//     for (const k in src)        "b"    node "ab"
//     Object.values(src).length    1     node 2
//     Object.entries(src)          same omission
//     Object.hasOwn(src, "a")     false  node true
//
// **And `"a" in src` answers `true`, correctly.** That is the useful half: the
// same question, asked two ways, answered differently by one compiler. `in`
// goes through `declares(type, key)` --- a question about the *type*, which
// knows perfectly well that `a` is a member --- and enumeration goes through
// `enumerable_fields`, a question about the *layout*, which holds storage and
// has no entry for a call. So the information is not missing; one of the two
// derivations is asking the wrong object.
//
// A getter on an object literal **is** an own enumerable property, so all four
// are wrong answers that compile. The boundary is already right on the other
// side and must stay there: a *class* getter lives on the prototype, is not
// own, and is correctly absent from `Object.keys(new C())` today --- as is a
// method. Both were probed.
//
// # Why it was not fixed with the spread
//
// `enumerable_fields` answers `(layout slot, name)`, and the whole difficulty
// is that a getter has no slot. `lower_in` is the shape to copy for the *names*
// --- ask the type --- and the values are the part that still needs a slot or a
// call decided per member. Its two callers want different halves:
// `own_names` needs only the name, and `decide_object_columns` reads
// `layout.fields[slot]` to emit a `FieldGet`. So the return type has to say
// *how* to get each value --- a slot or a call --- rather than assuming one.
//
// Order is part of it. The list is built by walking `layout.fields`, so
// appending accessors afterwards gives `["b", "a"]` where node says
// `["a", "b"]`. The source order lives on the type's `properties`, and that
// walk has to keep the fields a layout has and a type does not: a tuple's
// `_0`, a closure's capture, an anonymous member, all of which `enumerable_fields`
// deliberately keeps today.
//
// And one case needs a decision rather than a translation. A **setter-only**
// property is own and enumerable too --- `Object.keys({ set a(n) {}, b: 2 })`
// is `["a", "b"]` --- and its *value* is `undefined`, which a number slot
// cannot hold. That is a representation question, not a plumbing one, and it is
// the reason this is a separate piece of work rather than a larger diff here.
//
// `MemberKind::Accessor(Accessor)` already carries Get/Set/GetSet, so nothing
// needs to be learned from the frontend to do it.

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
