// `in` on a `Record` is always false.
//
//     "a" in o   with o = { a: 1 }    compiled 0   node 1   <-
//     "b" in o   with o = { a: 1 }    compiled 0   node 0
//     Object.hasOwn(o, "a")           compiled 1   node 1
//     o["a"]                          compiled 1   node 1
//     Object.keys(o).length           compiled 1   node 1
//
// **The object has the key.** Reading it works, `Object.hasOwn` finds it,
// `Object.keys` returns it. Only `in` does not, and the absent case agrees only
// because false happens to be the right answer there.
//
// # Why it is worse than a refusal
//
// `in` on a **bare `object`** refuses -- `blockers/in-on-an-undeclared-object`,
// which is the head of `Buffer.from` and therefore of `string_decoder`. So the
// same operator refuses in one type position and silently answers wrong in
// another, and the wrong answer is the one that compiles.
//
// It is the shape a feature test takes. `"code" in error`, `"then" in value`,
// `"length" in options` are how node's own source asks whether something is
// there, and every one of them now answers no.
//
// # The controls are three ways of asking the same question
//
// A defect where a single operator disagrees and three neighbours agree is the
// most confined kind there is, and it is confined because the object is
// correct: the key is stored, enumerable and readable. Nothing about the
// representation is wrong. The operator does not consult it.

export function inPresent(): number {
  const o: Record<string, number> = { a: 1 };
  return "a" in o ? 1 : 0;
}

export function inAbsent(): number {
  const o: Record<string, number> = { a: 1 };
  return "b" in o ? 1 : 0;
}

export function hasOwnPresent(): number {
  const o: Record<string, number> = { a: 1 };
  return Object.hasOwn(o, "a") ? 1 : 0;
}

export function readPresent(): number {
  const o: Record<string, number> = { a: 1 };
  return o["a"] ?? -1;
}

export function keysLength(): number {
  const o: Record<string, number> = { a: 1 };
  return Object.keys(o).length;
}
