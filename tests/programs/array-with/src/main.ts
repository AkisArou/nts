// Array.prototype.with changes one slot in a fresh array. copy and
// sliceControl differ only in spelling that operation; the old compiler
// refuses copy while sliceControl agrees with node.
export function copy(n: number): number {
  const source = [10, 20, 30];
  const index = ((n | 0) & 3) % 3;
  const result = source.with(index, ((n | 0) + 7) | 0);
  result[0] = (result[0]! + 1) | 0;
  return (source[0]! + source[1]! + source[2]! +
    result[0]! * 3 + result[1]! * 5 + result[2]! * 7) | 0;
}

export function sliceControl(n: number): number {
  const source = [10, 20, 30];
  const index = ((n | 0) & 3) % 3;
  const result = source.slice();
  result[index] = ((n | 0) + 7) | 0;
  result[0] = (result[0]! + 1) | 0;
  return (source[0]! + source[1]! + source[2]! +
    result[0]! * 3 + result[1]! * 5 + result[2]! * 7) | 0;
}

export function relativeIndex(index: number): number {
  const source = [10, 20, 30];
  try {
    const result = source.with(index, 8);
    return result[0]! * 100 + result[1]! * 10 + result[2]! + source[1]!;
  } catch (error) {
    return error instanceof RangeError ? -1 : -2;
  }
}

export function relativeEdges(n: number): number {
  const indices = [NaN, -0, 0.5, -0.5, 1.9, -1.9, 2.9, -2.9,
    3, -4, Infinity, -Infinity, 4294967297, -4294967297, -3, 0];
  return relativeIndex(indices[(n | 0) & 15]!);
}

export function empty(index: number): number {
  const source: number[] = [];
  try {
    return source.with(index, 8).length + 10;
  } catch (error) {
    return error instanceof RangeError ? -1 : -2;
  }
}

function replace(source: number[], index: number): number {
  return source.with(index, 8)[0]!;
}

export function caughtAcrossCall(index: number): number {
  try {
    return replace([1, 2, 3], index);
  } catch (error) {
    return error instanceof RangeError ? -1 : -2;
  }
}

export function referenceIdentity(n: number): number {
  const first = { value: n | 0 };
  const second = { value: 17 };
  const replacement = { value: 23 };
  const source = [first, second];
  const result = source.with(-1, replacement);
  return (result !== source && result[0] === first && result[1] === replacement &&
    source[1] === second ? 1000 : 0) + source[1]!.value + result[1]!.value;
}

export function stringElements(n: number): string {
  const source = ["first", "second", "third"];
  const result = source.with(-1, String(n));
  return source.join("/") + ":" + result.join("/");
}

export function booleanElements(n: number): number {
  const source = [true, false, true];
  const result = source.with(-1, (n | 0) > 0);
  return (source[2] ? 100 : 0) + (result[2] ? 10 : 0) + (result[0] ? 1 : 0);
}

export function erasedElements(n: number): string {
  const source: (number | string | undefined)[] = [11, undefined, "tail"];
  const result = source.with(-1, n | 0);
  return String(source[0]) + ":" + String(source[1]) + ":" + String(source[2]) +
    "/" + String(result[0]) + ":" + String(result[1]) + ":" + String(result[2]);
}

export function holesBecomeUndefined(n: number): string {
  const source: (number | undefined)[] = [1, , 3];
  const result = source.with(0, n | 0);
  return String(source[1]) + ":" + String(result[1]) + ":" +
    source.length + ":" + result.length + ":" + String(result[0]);
}

export function replacedHoleIsNotRead(n: number): number {
  const source = new Array<number>(1);
  return source.with(0, n | 0)[0]!;
}

export function argumentEffects(n: number): number {
  const source = [10, 20, 30];
  let order = 0;
  const index = (): number => { order = order * 10 + 1; return -1; };
  const value = (): number => {
    order = order * 10 + 2;
    source.push(40);
    return n | 0;
  };
  const result = source.with(index(), value());
  return (order * 1000 + source.length * 100 + result.length * 10 +
    source[3]! + result[3]!) | 0;
}

export function primitiveIndex(n: number): number {
  const choices: (number | string | boolean | null | undefined)[] =
    ["-1", true, null, undefined];
  const index: any = choices[(n | 0) & 3];
  return [10, 20, 30].with(index, 8).join(",").length;
}

export function indexTypeErrors(n: number): number {
  const index: any = ((n | 0) & 1) === 0 ? 1n : Symbol("index");
  try {
    return [10, 20, 30].with(index, 8).length;
  } catch (error) {
    return error instanceof TypeError ? 1 : -1;
  }
}

export function missingArguments(n: number): string {
  const source: unknown[] = [11, 22];
  if (((n | 0) & 1) === 0) {
    // @ts-ignore Deliberately exercise the JavaScript default arguments.
    const result = source.with();
    return String(result[0]) + ":" + String(result[1]);
  }
  // @ts-ignore Deliberately omit the replacement value.
  const result = source.with(-1);
  return String(result[0]) + ":" + String(result[1]);
}

export function nullReferenceSlots(n: number): string {
  const source: (string | null)[] = ["first", null, "third"];
  const result = source.with(0, String(n));
  return String(source[1]) + ":" + String(result[1]) + ":" + result[0];
}

export function undefinedReferenceSlots(n: number): string {
  const source: (string | undefined)[] = ["first", undefined, "third"];
  const result = source.with(0, String(n));
  return String(source[1]) + ":" + String(result[1]) + ":" + result[0];
}
