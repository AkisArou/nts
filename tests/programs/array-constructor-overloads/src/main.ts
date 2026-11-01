// Array's argument-list contract is shared by call and construction forms.
// Hole reads remain covered by a-hole-in-an-array-of-numbers-reads-as-zero;
// length-form controls here observe length without reading an unwritten slot.

export function noArguments(n: number): number {
  return new Array<number>().length + Array<number>().length + (n & 0);
}

export function oneBoolean(n: number): number {
  const xs = new Array<boolean>((n & 1) !== 0);
  return xs.length * 10 + (xs[0]! ? 1 : 0);
}

export function oneBigInt(n: number): number {
  const xs = new Array<bigint>(BigInt(n & 7));
  return xs.length * 10 + Number(xs[0]!);
}

export function invalidIntegerLength(n: number): number {
  try {
    return new Array<number>((n & 1) === 0 ? -1 : 4294967296).length;
  } catch (error) {
    return error instanceof RangeError ? 106 : -1;
  }
}

export function twoConstructed(n: number): number {
  const xs = new Array<number>(n, n + 1);
  return xs.length * 100 + xs[0]! + xs[1]!;
}

export function threeConstructed(n: number): number {
  const x = n & 7;
  const xs = new Array<number>(x, x + 1, x + 2);
  return xs.length * 1000 + xs[0]! * 100 + xs[1]! * 10 + xs[2]!;
}

export function twoCalled(n: number): number {
  const x = n & 7;
  const xs = Array<number>(x, x + 1);
  return xs.length * 100 + xs[0]! * 10 + xs[1]!;
}

export function oneString(n: number): number {
  const value = String(n & 7);
  const xs = new Array<string>(value);
  return xs.length * 10 + xs[0]!.length;
}

export function oneCalledString(n: number): number {
  const xs = Array<string>("a" + String(n & 7));
  return xs.length * 10 + xs[0]!.length;
}

export function numericLength(n: number): number {
  return new Array<number>(n & 7).length;
}

function invalidLength(n: number): number {
  return new Array<number>((n & 7) + 0.5).length;
}

export function fractionalLength(n: number): number {
  try {
    return new Array<number>((n & 7) + 0.5).length;
  } catch (error) {
    return error instanceof RangeError ? 101 : -1;
  }
}

export function nestedFractionalLength(n: number): number {
  try {
    return invalidLength(n);
  } catch (error) {
    return error instanceof RangeError ? 102 : -1;
  }
}

export function calledInvalidLength(n: number): number {
  try {
    return Array<number>((n & 7) - 0.5).length;
  } catch (error) {
    return error instanceof RangeError ? 103 : -1;
  }
}

export function nonfiniteLength(n: number): number {
  try {
    return new Array<number>((n & 1) === 0 ? NaN : Infinity).length;
  } catch (error) {
    return error instanceof RangeError ? 104 : -1;
  }
}

export function negativeZeroLength(n: number): number {
  const xs = new Array<number>((n & 1) === 0 ? -0 : 0);
  return Object.is(xs.length, -0) ? -1 : 105;
}

export function tupleSpread(n: number): number {
  const x = n & 7;
  const pair: [number, number] = [x, x + 1];
  const xs = new Array<number>(...pair);
  return xs.length * 100 + xs[0]! * 10 + xs[1]!;
}

export function dynamicSpread(n: number): number {
  const values: number[] = [];
  if ((n & 1) !== 0) values.push(3);
  if ((n & 2) !== 0) values.push(4);
  return new Array<number>(...values).length;
}

export function calledDynamicSpread(n: number): number {
  const values: number[] = [];
  if ((n & 1) !== 0) values.push(3);
  if ((n & 2) !== 0) values.push(4);
  return Array<number>(...values).length;
}

export function prefixSpread(n: number): number {
  const values: number[] = [];
  if ((n & 1) !== 0) values.push(7);
  return new Array<number>(5, ...values).length;
}

export function spreadBeforeMutation(n: number): number {
  const source = [n & 7];
  function later(): number {
    source.push(9);
    return 8;
  }
  const xs = new Array<number>(...source, later());
  return xs.length * 100 + xs[0]! * 10 + xs[1]!;
}

function make<T>(value: T): T[] {
  return new Array<T>(value);
}

export function genericInstantiations(n: number): number {
  return make(n & 7).length * 10 + make("x").length;
}

function unknownValue(value: number | string): number {
  return new Array<unknown>(value).length;
}

export function runtimeSingletonType(n: number): number {
  return unknownValue((n & 1) === 0 ? 3 : "3");
}

export function shadowedArray(n: number): number {
  function Array(a: number, b: number): number {
    return a * 10 + b;
  }
  return Array(n & 7, 2);
}

export function evaluatesEveryArgument(n: number): number {
  let state = n & 3;
  function next(): number {
    state += 1;
    return state;
  }
  const xs = new Array<number>(next(), next(), next());
  return state * 10000 + xs.length * 1000 + xs[0]! * 100 + xs[1]! * 10 + xs[2]!;
}

const moduleArray = new Array<number>(2, 3);

export function moduleScope(n: number): number {
  return moduleArray.length * 100 + moduleArray[0]! * 10 + moduleArray[1]! + (n & 0);
}
