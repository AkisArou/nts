// expect: emit-jvm -> storing a `Closure1` where a `Fn2__2` is declared
//
// `() => 1` passed where `(c: number) => number` is declared.
//
// **TypeScript permits a callback to ignore trailing parameters** and every
// JavaScript programmer writes it. `relate_closures_to_signatures` matches a
// closure to its slot by `signature_key`, which compares the parameter lists
// for *equality*:
//
//     Closure1  key = ([],          TypeId(2), false)    () => 1
//     declared  CB  = ([TypeId(2)], TypeId(2), false)    (c: number) => number
//
// They do not match, no layout claims the closure, and it gets no base. C does
// not care -- it reaches a closure through a slot and a pointer -- so this is
// refused on the JVM alone, where a field declared with the base type will not
// hold a class that does not extend it.
//
// # The control is one token
//
// `withMatchingArity` is the identical program with `(_c) => 1`. **Zero
// declines.** Everything else is held fixed.
//
// # Three accounts of this reduction, each removing a feature the last called
// essential
//
// It was reported as "an async arrow that captures a value". Reproducing that
// description faithfully -- an async arrow capturing a `number` -- does not
// fail, and two lanes spent an exchange on it. The accounts went:
//
//     an async arrow that captures                    wrong
//     a Promise-returning capture, or an `await`      wrong
//     a callback literal with fewer parameters        this
//
// Nothing here is `async`. Nothing here is a promise. The fixture is five lines
// and the first four descriptions of it all named features it does not need.
//
// **A prose description of a reduction is a hypothesis about which of its
// features matters**, written by the person least able to test it, because
// their program has all of them. Send the file.
//
// # And a minimal pair isolates a token, not a mechanism
//
// A sibling reduction in the same report differs by exactly one `await` and
// declines with the *same message* for an unrelated reason: `await` of a
// non-promise is refused by name -- `await 5` is legal JavaScript meaning
// `Promise.resolve(5)`, and the tick is observable -- which removes the
// closure's `call` and leaves a layout with no method. The JVM then reports the
// consequence in the same sentence it uses for a missing base.
//
// So a perfect one-token pair still pointed at the wrong pass, because the
// outcome it compares is a message that means several things. When a message is
// ambiguous every instrument built on it inherits the ambiguity, a minimal pair
// included.
//
// # What a fix needs, which is not a looser match rule
//
// Relating them is easy; the JVM then needs `Closure1#call` to carry the
// *declared* descriptor, and it has one parameter fewer. So the closure's
// `call` must be emitted at the declared arity with the extra parameters
// unread, which means the arity has to reach `lower_closure`, and nothing
// carries it there today. A match rule alone would produce a class claiming a
// base whose method it does not implement -- the same failure one link later.

type CB = (c: number) => number;

/** Under test: the callback literal has no parameters and its slot declares one. */
export function make(cb: CB): (c: number) => number {
  return (c): number => cb(c) + 1;
}

export function drive(n: number): number {
  return make(() => 1)(n | 0);
}

/** Control: the same with the arity matched. Declines nothing. */
export function makeMatched(cb: CB): (c: number) => number {
  return (c): number => cb(c) + 1;
}

export function withMatchingArity(n: number): number {
  return makeMatched((_c) => 1)(n | 0);
}
