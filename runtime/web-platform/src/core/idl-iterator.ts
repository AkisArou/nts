// WebIDL's iterator prototype object, and the iterators that inherit from it.
//
// An interface with an `iterable<>` declaration gets one prototype object *per interface*
// (WebIDL 3.7.10). Its [[Prototype]] is %IteratorPrototype%, it carries `next` as a writable,
// enumerable, configurable data property, and its `Symbol.toStringTag` names the interface.
//
// **A generator is not that**, which is what `headers-basic.any.js` checks and what this exists
// to fix. A generator object's chain is
//
//     generator -> the generator function's `.prototype` -> %GeneratorPrototype% -> %IteratorPrototype%
//
// which is one level too deep, and its `next` is non-enumerable and shared with every other
// generator in the realm. Three upstream tests fail on exactly that and on nothing else: the
// values a generator yields are already right.
//
// The traversal stays a generator, because "walk the pairs" is what a generator is for. Only the
// object handed to the caller changes, so iteration order, liveness under mutation and the
// values themselves are untouched by construction.

/**
 * %IteratorPrototype%, reached the only way the language exposes it: it is the prototype of the
 * prototype of an array iterator, and it has no global binding of its own.
 */
const ITERATOR_PROTOTYPE: object = Object.getPrototypeOf(
  Object.getPrototypeOf([][Symbol.iterator]()),
) as object;

/** Where an iterator keeps the traversal it is draining. Not reachable from script. */
const STEPS = Symbol("WebIDL iterator steps");

interface IdlIteratorObject {
  [STEPS]?: Iterator<unknown>;
}

/**
 * The iterator prototype object for one interface.
 *
 * Built once per interface and shared by every iterator that interface hands out, which is what
 * makes `Object.getPrototypeOf(headers.keys()) === Object.getPrototypeOf(headers.values())` --
 * the property WebIDL requires and a generator cannot give, since a generator function has its
 * own `.prototype` per function.
 */
export function idlIteratorPrototype(tag: string): object {
  const prototype = Object.create(ITERATOR_PROTOTYPE) as IdlIteratorObject;
  Object.defineProperty(prototype, "next", {
    // Writable, enumerable and configurable: all three are asserted upstream, and all three are
    // false for the `next` a generator inherits.
    value: function next(this: IdlIteratorObject): IteratorResult<unknown> {
      const steps = this[STEPS];
      if (steps === undefined) {
        throw new TypeError(`next called on an object that is not a ${tag}`);
      }
      return steps.next();
    },
    writable: true,
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(prototype, Symbol.toStringTag, {
    value: tag,
    writable: false,
    enumerable: false,
    configurable: true,
  });
  return prototype;
}

/**
 * One iterator over `steps`, inheriting from `prototype`.
 *
 * `Symbol.iterator` is not defined here: %IteratorPrototype% already carries one returning
 * `this`, which is the whole reason the chain has to reach it.
 */
export function idlIterator<T>(prototype: object, steps: Iterator<T>): IterableIterator<T> {
  const iterator = Object.create(prototype) as IdlIteratorObject;
  iterator[STEPS] = steps as Iterator<unknown>;
  return iterator as unknown as IterableIterator<T>;
}
