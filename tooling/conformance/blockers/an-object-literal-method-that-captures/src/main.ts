// expect: NTS1001 `n`, a name from an enclosing scope
//
// An object literal whose **method** reads a local of the enclosing function.
// Written as an arrow property, the identical program lowers:
//
// ```text
// const o = { go(): number { return n * 2; } };      REFUSED
// const o = { go: (): number => n * 2 };             lowers
// ```
//
// # Isolated one factor at a time
//
// ```text
// method capturing a local      REFUSED  `n`, a name from an enclosing scope
// getter capturing a local      REFUSED  the same
// arrow property capturing it   lowers
// method at module scope        lowers   -- `n` is a global, reached by name
// method capturing nothing      lowers
// ```
//
// So it is neither object literals nor methods: it is a literal *member* that
// needs a capture environment and has none.
//
// # Why
//
// `collect_closures` treats `ARROW_FUNCTION` and `FUNCTION_EXPRESSION` as
// closures and nothing else. A literal's method is lowered by
// `lower_object_literal_members` through `lower_method_of(literal, member,
// Some(instance))` -- a **method**, which gets `this` and no captures. An arrow
// property is a closure, which is why the two spellings differ.
//
// # 24 of the 35 sites in that census row
//
// `runtime/node/events/src/main.ts:1791` is the shape, and it is not a corner:
//
//     const iterator: EventAsyncIterator = {
//       next(): Promise<IteratorResult<unknown>> {
//         if (unconsumedEvents.size > 0) { ... }        // enclosing locals
//       },
//       [Symbol.asyncIterator](): AsyncIterableIterator<unknown> {
//         return iterator;
//       },
//       [kWatermarkData]: {
//         get size(): number { return unconsumedEvents.size; },
//         get isPaused(): boolean { return paused; },
//       },
//     };
//
// # A narrow route exists, and the guard for it is already written
//
// A method's `this` is the object and an arrow's is the enclosing function, so
// the two spellings are equivalent **exactly when the body does not use its
// receiver** -- and `uses_its_receiver` (`lower.rs:981`) answers that today,
// walking into arrows because they inherit `this` and counting `super` as the
// receiver under another name. `refusal_for_a_method_value` already relies on
// it for the same kind of question.
//
// So: collect a literal's `METHOD_DECLARATION`, `GET_ACCESSOR` and
// `SET_ACCESSOR` as closures when `!uses_its_receiver`, and the existing
// capture machinery supplies the environment. `lower_object_literal_members`
// then lowers those members as closure-valued properties rather than methods.
//
// A member that *does* use `this` keeps the refusal, which is honest: it needs
// both a receiver and an environment, and that is the general feature rather
// than this one.
//
// Enumeration is unaffected either way -- a method shorthand and an arrow
// property are both own enumerable properties in JavaScript, which is what
// `enumerable_fields` already answers.

export function captured(x: number): number {
  const n = 5 + (x - x);
  const o = {
    go(): number {
      return n * 2;
    },
  };
  return o.go();
}
