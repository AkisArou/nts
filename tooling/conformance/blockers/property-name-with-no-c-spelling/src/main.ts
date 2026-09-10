// expect: emit-c --napi -> calls exports.use(1) === 7
// control: typeof exports.use === "function"
//
// **Kept as a guard. Escaped rather than refused, 2026-09-10.**
//
// A quoted property name containing a character C cannot spell -- `"a b"` came
// back verbatim and took `int32_t a b;` with it. `c_identifier`'s first branch
// is injective and deliberately so, but it only ran for the five qualifiers
// this compiler puts in a name itself, and a TypeScript property may carry any
// character at all.
//
// Found by the JVM lane, who had the identical defect in `jvm_member_name`:
// their hand-listed `match` of six characters was short by twenty-two, so a
// list became a predicate.
//
// # Why it was refused, and why that stopped being the answer
//
// This file used to argue that escaping was wrong because "the catch-all maps
// every other character to `_`, which is not injective -- `a b` and `a+b` would
// be one C name -- and an injective escape costs every generated name its
// readability for a construct no program in this tree writes."
//
// **Both halves were false.** `c_member_escaped` is injective: `_x` plus the
// byte in hex, so `a b` is `a_x20b` and `x+y` is `x_x2by`. It costs no
// readability either, because a name that is already a C identifier is returned
// unchanged and only an unspellable one is escaped.
//
// And a program in this tree does write one: `http`'s status table is
// `{ 100: "Continue", 101: "Switching Protocols", ... }`, where a leading digit
// is every-character-legal and still not an identifier.
//
// # The refusal emitted invalid C anyway, which is what settled it
//
// Skipping the struct left its descriptor and reference tables behind --
// `offsetof(NtsObj_Type11376, 100)` for a struct that was never defined.
// `emit.rs` carries a comment about exactly that shape, "a struct missing a
// field the reference map still points at is not a smaller object, it is a
// wrong one", and the guard written to prevent it was doing it. Unreachable
// until `http`'s `module#init` began to compile, which is a state a predicate
// can sit in for a long time.
//
// # What this fixture asserts now
//
// That the values **round trip**: `use(1)` is `1 + 2 + 3 + 1`. A spelling that
// merely compiles is not enough -- two names escaping to one would compile and
// return the wrong sum, which is why both `"a b"` and `"x+y"` are here and why
// the assertion is an answer rather than an absence.
//
// `ordinary` is the control inside the class: it spells fine, so an escape that
// touched it would mean the predicate had gone too wide.
//
class Holder {
  "a b": number = 1;
  "x+y": number = 2;
  ordinary: number = 3;
}

export function use(n: number): number {
  const h = new Holder();
  return h["a b"] + h["x+y"] + h.ordinary + n;
}
