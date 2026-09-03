// What the mutating and copying array operations cost.
//
// `array-methods` covers the predicates, which allocate nothing but `filter`'s
// one result. These are the other half of the surface: two that move elements
// within an array they already have, and four that hand back a new one.
//
// The question each is here to answer is whether it allocates *once*.

export function work(n: number): number {
  const xs: number[] = [];
  for (let i = 0; i < 16 + n; i = i + 1) {
    xs.push(i);
  }

  let total = 0;
  // Moves the rest down. Nothing is made.
  total = total + (xs.shift() ?? 0);
  // Moves the rest up, into room the array already has.
  xs.unshift(99);

  // The removed run, and the only thing `splice` makes.
  const gone = xs.splice(1, 2);
  total = total + gone.length;

  const joined = xs.concat(gone);
  total = total + joined.length;

  const copy = [...xs];
  total = total + copy.length;

  const from = Array.from(xs);
  total = total + from.length;

  return total;
}
