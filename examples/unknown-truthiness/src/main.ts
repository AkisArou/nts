// Truthiness of a value that carries its own tag.
//
// `if (v)` on an erased value is one rule over the tag, so it lives in the
// runtime as `nts_value_truthy` rather than being spelled inline at every site
// that tests one. Each arm below is a case of that rule, and node is the
// oracle for all of them:
//
//   undefined and null   falsy
//   a boolean            itself
//   a number             falsy at zero and at NaN, truthy otherwise
//   a string             falsy when empty, however present it is
//   an object or array   truthy whatever it holds — `if ([])` runs
//
// The reason it exists is `a || b`: the left operand is *tested* and then one
// side or the other becomes the value, so a union with an absence in it lands
// on a tag test rather than on a comparison against zero.

function pick(n: number, which: number): unknown {
  if (which === 0) {
    return undefined;
  }
  if (which === 1) {
    return n;
  }
  if (which === 2) {
    return n > 0 ? "text" : "";
  }
  if (which === 3) {
    return n > 0;
  }
  return [n];
}

export function truthiness(n: number): number {
  let count = 0;
  for (let which = 0; which < 5; which += 1) {
    if (pick(n, which)) {
      count += 1;
    }
  }
  return count;
}

// Zero and NaN are the two numbers that are falsy, and they are the reason the
// rule is not "is the payload non-zero".
export function falsyNumbers(n: number): number {
  const zero: unknown = n - n;
  const nan: unknown = n / 0 - n / 0;
  let count = 0;
  if (zero) {
    count += 1;
  }
  if (nan) {
    count += 1;
  }
  return count + n;
}

// `||` over a union with an absence: the arms disagree about representation
// and the join is what makes them agree.
export function orElse(n: number): number {
  const limit: number | undefined = n > 2 ? n : undefined;
  const chosen = limit || undefined;
  return chosen === undefined ? -1 : chosen;
}
