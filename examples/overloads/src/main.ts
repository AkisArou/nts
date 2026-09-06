// Overload signatures, and the implementation every call actually reaches.
//
// TypeScript matches a call against whichever *signature* fits, and those are
// separate declarations with no bodies. Only the implementation is emitted, so
// a call built against the resolved signature's parameter list is built against
// the wrong one — `pick(a)` matching `pick(a: number)` and landing on
// `pick(a, b)`.
//
// That was refused outright, and refusing only the signatures was worse: it
// left the implementation lowered and produced `CallArgumentCount { expected:
// 3, found: 2 }` — invalid HIR from a program every refusal had been reported
// for.

class Picker {
  pick(a: number): number;
  pick(a: number, b: number): number;
  pick(a: number, b?: number): number {
    return b === undefined ? a : (a + b) | 0;
  }

  // Three signatures and a wider implementation, so the arity gap is more than
  // one and the *middle* signature is the one some calls match.
  span(a: number): number;
  span(a: number, b: number): number;
  span(a: number, b: number, c: number): number;
  span(a: number, b?: number, c?: number): number {
    const second = b === undefined ? 0 : b;
    const third = c === undefined ? 0 : c;
    return (a + second * 10 + third * 100) | 0;
  }

  // An implementation whose extra parameter has a **default** rather than being
  // optional. The omitted argument is then an expression evaluated at the call,
  // not an `undefined`, which is a different path.
  scaled(a: number): number;
  scaled(a: number, by: number): number;
  scaled(a: number, by = 3): number {
    return (a * by) | 0;
  }
}

export function oneOrTwo(n: number): number {
  const p = new Picker();
  return p.pick(n) * 1000 + p.pick(n, 2);
}

export function threeArities(n: number): number {
  const p = new Picker();
  return p.span(n) + p.span(n, 1) + p.span(n, 1, 1);
}

export function withADefault(n: number): number {
  const p = new Picker();
  return p.scaled(n) * 1000 + p.scaled(n, 2);
}

// The same, as a plain function. A method call takes its name from the
// hierarchy; a plain function has only the declaration to ask — so this one
// resolved to a signature with no body, was called external, and produced
// `undefined reference to 'pick'` from the linker on a program that reported no
// refusal at all.
function combine(a: number): number;
function combine(a: number, b: number): number;
function combine(a: number, b?: number): number {
  return b === undefined ? a * 2 : (a + b) | 0;
}

export function throughAFunction(n: number): number {
  return combine(n) * 1000 + combine(n, 5);
}

// An overload set where the implementation takes a **rest**, so the omitted
// arguments are an empty array rather than an absence.
function total(a: number): number;
function total(a: number, b: number): number;
function total(a: number, ...rest: number[]): number {
  let sum = a;
  for (let i = 0; i < rest.length; i++) {
    sum = (sum + rest[i]!) | 0;
  }
  return sum;
}

export function throughARest(n: number): number {
  return total(n) * 1000 + total(n, 7);
}
