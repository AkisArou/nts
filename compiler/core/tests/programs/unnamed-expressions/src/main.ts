// Constructs that used to be refused as "this expression".
//
// The expression lowering's fallthrough names nothing, and a refusal nobody
// can group by is a refusal nobody can rank -- so anything landing there is
// invisible to whoever is deciding what to implement next. This fixture is the
// bucket, emptied: each construct here has a refusal that names it, and each
// name pins a syntax constant read off the checker's enum.
//
// If one of those constants is wrong the construct silently rejoins the
// anonymous bucket, which is the failure this fixture exists to catch.

// No `this`: an arrow with the same body would lower, and the diagnostic says
// so.
export function plainFunctionExpression(n: number): number {
  const f = function (k: number): number {
    return k + 1;
  };
  return f(n);
}

// Uses its own `this`, so an arrow is *not* equivalent -- it would rebind to
// the enclosing scope. This is `util.deprecate`'s shape, which forwards the
// caller's receiver, and suggesting the rewrite here would turn a refusal into
// a method quietly operating on the wrong object.
export function usesThis(n: number): number {
  const f = function (this: { base: number }, k: number): number {
    return this.base + k;
  };
  return f.call({ base: 1 }, n);
}

// A nested *arrow* inherits `this` from the function expression around it, so
// this one uses `this` too even though the keyword is a level down.
export function usesThisThroughAnArrow(n: number): number {
  const f = function (this: { base: number }, k: number): number {
    const inner = (): number => this.base;
    return inner() + k;
  };
  return f.call({ base: 1 }, n);
}

export function regularExpression(n: number): number {
  const pattern = /^a+$/;
  return pattern.source.length + n;
}
