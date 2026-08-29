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
export function functionExpression(n: number): number {
  const f = function (k: number): number {
    return k + 1;
  };
  return f(n);
}

export function regularExpression(n: number): number {
  const pattern = /^a+$/;
  return pattern.source.length + n;
}
