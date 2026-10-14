// What a parameter's declaration says, beyond its type.
//
// The type does not carry it. `...args: number[]` and `args: number[]` are the
// same `Managed(Array(f64))`; `x?: number` and `x: number = 1` are both an
// `f64` slot the callee always has. TypeScript distinguishes all three and the
// HIR used to drop the distinction — while `lower_param` computed both halves
// of it and threw them away, which is a precision loss of the kind
// `docs/conformance/typescript.md` §16 exists to record.
//
// Nothing is emitted for the distinction: a parameter is a parameter in every
// backend whatever its shape, and the work a rest or a default implies happens
// at the *call*. `lower_arguments` gathers the array and evaluates the default,
// which is where JavaScript evaluates it.
//
// The behaviour here is unchanged — this file is what says so.

// A rest parameter and an ordinary array parameter, side by side. They are the
// same HIR type, and telling them apart is the whole point.
function sum(...values: number[]): number {
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    total = total + values[i]!;
  }
  return total;
}

function sumArray(values: number[]): number {
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    total = total + values[i]!;
  }
  return total;
}

export function restAndArray(n: number): number {
  const size = n > 0 && n < 8 ? n | 0 : 3;
  const built: number[] = [];
  for (let i = 0; i < size; i++) {
    built.push(i);
  }
  return sum(1, 2, 3) + sumArray(built) * 1000;
}

// A defaulted parameter. The *caller* evaluates the initializer — JavaScript
// does too — so the callee's slot is ordinary and always present.
function scaled(value: number, by: number = 10): number {
  return value * by;
}

export function defaulted(n: number): number {
  return scaled(n) + scaled(n, 2) * 1000;
}

// An optional parameter, which is a different case. Omitted means `undefined`
// *inside* the callee, and the callee can see it — which is exactly why
// supplying `0` for one would be wrong rather than imprecise.
function labelled(value: number, extra?: number): number {
  if (extra === undefined) {
    return value;
  }
  return value + extra * 100;
}

export function optional(n: number): number {
  return labelled(n) + labelled(n, 3) * 1000;
}

// All three in one signature, in the order TypeScript requires.
function everything(first: number, second: number = 5, ...rest: number[]): number {
  let total = first + second * 10;
  for (let i = 0; i < rest.length; i++) {
    total = total + rest[i]! * 100;
  }
  return total;
}

export function together(n: number): number {
  return everything(n) + everything(n, 1) + everything(n, 1, 2, 3);
}

// An optional beside a rest is not legal TypeScript, so the pair that can share
// a signature is optional-then-rest through a second function.
function eitherWay(base: number, tweak?: number): number {
  return tweak === undefined ? base : base * tweak;
}

export function optionalAmongOrdinary(n: number): number {
  return eitherWay(n) + eitherWay(n, 2) * 1000;
}
