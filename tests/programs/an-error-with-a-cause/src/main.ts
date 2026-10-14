// `new Error(message, { cause })`, which the React lane's `throwException` writes
// three times on the error path of every render.
//
// `cause` was listed as a member this compiler does not provide, with the reason
// "the chained error would have to be a reference to any error type" -- which is
// what an erased slot holds. It is a field now: third in every error class's
// layout, before `AggregateError`'s `errors`, so an `Error` reaching a slot
// declared for it still finds the shared members at the same indices.
//
// `stack` stays refused and always will. The two were one sentence in
// `builtin.rs`'s header and are two different answers: one was waiting for a
// presence bit that has existed for a fortnight, and the other is a fact about
// compilation.

/** The shorthand spelling, which is the one React writes. */
export function shorthand(n: number): number {
  const inner = new Error("inner");
  const outer = new Error("outer", { cause: inner });
  return outer.cause === inner ? 100 + n * 0 : -1;
}

/** A written property rather than shorthand. */
export function written(n: number): number {
  const outer = new Error("outer", { cause: n });
  return outer.cause === n ? 100 : -1;
}

/**
 * **The slot is erased, so a cause is any value.** A string here rather than an
 * error, because `unknown` is what the language declares `cause` as and a slot
 * that only held references would be a narrower thing wearing the same name.
 */
export function stringCause(n: number): number {
  const e = new Error("m", { cause: "why" });
  return typeof e.cause === "string" ? 100 + n * 0 : -1;
}

/**
 * **Present and undefined is not absent.** `{ cause: undefined }` writes the
 * property, so reading it gives `undefined` rather than the slot never having
 * been written -- which is the distinction a presence bit exists for, and the
 * reason the cause is lowered *expecting* an erased slot rather than coerced
 * into one afterwards.
 */
export function explicitlyUndefined(n: number): number {
  const e = new Error("m", { cause: undefined });
  return (e.cause === undefined ? 100 : 0) + n * 0;
}

/**
 * **Control: no options at all.** Reading `cause` gives `undefined`, and nothing
 * was stored -- which is what makes `"cause" in e` false in node. That `in` is
 * not driven here: `in` on a *provided* class refuses for every member, `message`
 * included, which is a standing gap of its own and not this one.
 */
export function noOptions(n: number): number {
  const e = new Error("m");
  return (e.cause === undefined ? 100 : 0) + n * 0;
}

/**
 * **Control: a subclass.** `cause` sits in the shared prefix, so a subclass's own
 * field lands after it and the base's members keep their indices. This is the arm
 * that would catch the layout shift going wrong -- and the JVM is the backend that
 * notices, since C and LLVM spell every reference the same way.
 */
class Coded extends Error {
  code = 7;
}

export function throughSubclass(n: number): number {
  const e = new Coded("boom");
  return e.code + e.message.length + n * 0;
}

/** **Control.** `AggregateError`'s own member still works, one index further on. */
export function aggregate(n: number): number {
  const e = new AggregateError([new Error("a")], "many");
  return e.message.length + n * 0;
}
