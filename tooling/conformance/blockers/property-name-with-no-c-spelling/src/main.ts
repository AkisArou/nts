// expect: emit-c --napi -> a property named `a b`, which contains ` ` and so has no C spelling
//
// A quoted property name containing a character C cannot spell.
//
//     class Holder { "a b": number = 1 }
//     ->  int32_t a b;
//     program.c:8:14: error: expected ';' at end of declaration list
//
// `c_identifier`'s first branch is injective and its comment says so
// deliberately: `#`, `.` and `@` each get their own spelling "so that two
// different qualified names cannot become one C name". But that branch only ran
// when the name contained one of those five qualifiers, and a TypeScript
// property may legally carry any character at all -- so `"a b"` took the `else`
// and came back verbatim, taking `_Static_assert(offsetof(NtsObj_Holder, a b))`
// with it.
//
// Found by the JVM lane, who had the identical defect in `jvm_member_name` and
// fixed it the same way: their hand-listed `match` of six characters was short
// by twenty-two, so a list became a predicate.
//
// Refused rather than escaped, and the reason is in `unspellable_in_c`: the
// catch-all maps every other character to `_`, which is **not** injective --
// `a b` and `a+b` would be one C name -- and an injective escape costs every
// generated name its readability for a construct no program in this tree
// writes.
//
// The `emit-c ->` prefix is load-bearing: without it the harness runs
// `nts hir`, which is the raw lowering and never reaches the C backend at all,
// so the refusal this fixture is about cannot appear. It reported FIXED --
// "no longer refuses" -- for a construct that refuses every time.
//
// The expectation is the diagnostic, and `lacks-c NtsObj_Holder` was tried
// first and is wrong: the typedef and the descriptor are emitted before the
// body, so the name survives a refusal that suppresses every use of it. What
// the fixture asserts is that the construct is *named*, which is the thing that
// changed.
//
// Refusing the whole struct rather than the field is deliberate and the first
// attempt got it wrong. Skipping the field alone left the struct two members
// short with two `_Static_assert(offsetof(NtsObj_Holder, a b))` lines still
// naming them -- emitted from `layout.fields` further down. `emit.rs` already
// carries a comment about exactly that shape: "a struct missing a field the
// reference map still points at is not a smaller object, it is a wrong one".
//
// `ordinary` is the control. It spells fine, so a refusal that named it would
// mean the predicate had gone too wide.
class Holder {
  "a b": number = 1;
  "x+y": number = 2;
  ordinary: number = 3;
}

export function use(n: number): number {
  const h = new Holder();
  return h["a b"] + h["x+y"] + h.ordinary + n;
}
