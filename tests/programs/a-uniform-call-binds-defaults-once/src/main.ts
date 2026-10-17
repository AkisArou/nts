// Open exported callers keep the implementation's defaults unavailable at the
// call site. The supplied-argument arm is the one-change control for omission.
// A default belongs to the implementation, runs once for exactly undefined,
// and sees the same captures and earlier bindings as a direct invocation.
export function invoke(callback: (x?: any) => number, mode: number, n: number): number {
  if (mode === 0) return callback();
  if (mode === 1) return callback(undefined);
  return callback(n);
}

function selected(mode: number, n: number): number {
  let effects = 0;
  const callback = (value: number = (effects++, n + 3)): number => value;
  const result: number = invoke(callback, mode, n);
  return result + effects * 1000;
}

export function omitted(n: number): number { return selected(0, n); }
export function explicitUndefined(n: number): number { return selected(1, n); }
export function supplied(n: number): number { return selected(2, n); }

export function returnsUndefined(n: number): number {
  let effects = 0;
  const callback = (value: any = (effects++, undefined)): number =>
    (value === undefined ? 10 : 20) + effects;
  return invoke(callback, 0, n);
}

export function invokeTwo(callback: (x?: any, y?: any) => number, n: number): number {
  return callback(n);
}

export function earlierParameter(n: number): number {
  return invokeTwo((a: number, b: number = a + 3): number => b, n);
}

export function nullable(n: number): number {
  let effects = 0;
  const callback = (value: number | null = (effects++, n + 3)): number =>
    (value === null ? 100 : value) + effects * 1000;
  const open: (x?: any) => number = callback;
  return open(null);
}

export function throwingDefault(n: number): number {
  const token = { value: n };
  const callback = (value: number = (() => { throw token; })()): number => value;
  try {
    return invoke(callback, 0, n);
  } catch (error) {
    return error === token ? 2000 + n : -2000;
  }
}

function declared(value: number = 3): number { return value; }
export function declarationAsValue(n: number): number {
  return invoke(declared, 0, n);
}
