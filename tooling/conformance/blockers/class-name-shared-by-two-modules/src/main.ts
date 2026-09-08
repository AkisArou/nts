// expect: emit-c -> emits-c double useA(double v0)
//
// FIXED, kept as a guard. Two modules each declaring a class of the same name,
// where **the one with nothing wrong with it was refused** -- reported as
// calling a constructor that "was refused above" when nothing about it was.
//
//     `useA` cannot be compiled because it calls `Frame#constructor`,
//     which was refused above
//
// The names are qualified, and only in one direction. The lowering emits the
// definition as `Frame@a#constructor` -- `Naming::qualified` gives a
// declaration a `@module` suffix whenever the name is declared in more than one
// file -- while `lower_new` names the callee from the **source text of the
// identifier**, which is `Frame`. So `drop_callers_of_refused` looks up
// `Frame#constructor` in the set of functions that exist, does not find it, and
// drops the caller as a cascade.
//
// Nothing is refused. There is no root refusal anywhere in this file, which is
// what makes it expensive to find: the diagnostic says a refusal happened
// "above" and there is none, and every printed name has its qualifier stripped,
// so the log cannot say which of the two classes it means.
//
// **It blocks JSON.** `json/parse.ts` and `json/stringify.ts` each declare a
// `Frame`, so `readValue`, `parseJsonText` and `stringifyJsonValue` are all
// dropped -- the parser has no presence on the compiled axis and the shipped
// serializer none either. `JSON-HANDOFF.md` records `Number(string)` as the one
// remaining refusal on that chain; it landed, and this was underneath it.
//
// The companion `class-name-unique-to-one-module` is the control: the same
// class, the same fields, one declaration, and it compiles. Without it this
// fixture reads as "a class with an array field does not lower".
//
// The fix is one line at the call site: `lower_new` asks `Naming::qualified`
// for the class the same way `class_name_for` already does on the definition
// side, and only where the class written at `new` is the one declaring the
// constructor -- an inherited constructor is named for the base, and
// qualifying by the derived identifier would swap one wrong name for another.
//
// Six cascades across `runtime/web-platform`, which is a small number for what
// it is: `readValue`, `parseJsonText`, `jsonParse` and `stringifyJsonValue`
// among them, so it is the difference between JSON having a compiled presence
// and having none.
import { useA } from "./a.js";
import { useB } from "./b.js";

export function run(n: number): number {
  return useA(n);
}

export function alsoRun(): boolean {
  return useB() !== null;
}
