// A `function` expression held in a `const` and captured by another closure.
//
// The capture's field is typed at the closure the `const` holds, so the value
// stored and the value read are one class. That was asked of an arrow alone,
// so a `function` expression's field was typed at the checker's function type
// while its closure object was stored in it, and the pair was refused as "a
// parameter this copy re-typed" where no copy was involved. Found writing
// `examples/a-function-that-reads-its-own-this`; it refused on main before
// that work, with no `this` anywhere. Each case mixes the two spellings.

/** A `function` expression captured by a `function` expression. */
export function functionInFunction(n: number): string {
  const visit = function (by: number): string {
    return "v" + String(by);
  };
  const outer = function (by: number): string {
    return visit(by);
  };
  return outer(n & 3);
}

/** A `function` expression captured by an arrow. */
export function functionInArrow(n: number): string {
  const visit = function (by: number): string {
    return "w" + String(by * 2);
  };
  const outer = (by: number): string => visit(by) + visit(by + 1);
  return outer(n & 3);
}

/** An arrow captured by a `function` expression. */
export function arrowInFunction(n: number): string {
  const visit = (by: number): string => "a" + String(by);
  const outer = function (by: number): string {
    return visit(by);
  };
  return outer(n & 3);
}

/** Called with `.call` through the capture, as React's `Children.forEach` does. */
export function callThroughTheCapture(n: number): string {
  const visit = function (this: unknown, by: number): string {
    return (this === undefined ? "none" : "some") + String(by);
  };
  const outer = function (this: unknown, by: number): string {
    return visit.call(this, by);
  };
  return outer.call({}, n & 3) + "/" + outer(1);
}
