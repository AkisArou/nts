// Clean 75a: C/LLVM/JVM stop at the 17-abort limit, with 186/232
// compared; Wasm declines 24/232, with 208 compared. Controls agree.
// A tuple position, apply/call argument and captured bind argument each
// keep their own optional-string source type until uniform erasure. The
// control changes only undefined to a present string.
function target(value: string = "missing"): number { return value.length; }
export function spreadSubject(n: number): number {
  const callback = target as (value: string | undefined) => number;
  const value: string | undefined = n < 0 ? undefined : "abc";
  const args: [string | undefined] = [value];
  return callback(...args);
}
export function spreadControl(n: number): number {
  const callback = target as (value: string | undefined) => number;
  const value: string | undefined = n < 0 ? "abc" : "abc";
  const args: [string | undefined] = [value];
  return callback(...args);
}
export function applySubject(n: number): number {
  const callback = target as (value: string | undefined) => number;
  const value: string | undefined = n < 0 ? undefined : "abc";
  const args: [string | undefined] = [value];
  return callback.apply(undefined, args);
}
export function applyControl(n: number): number {
  const callback = target as (value: string | undefined) => number;
  const value: string | undefined = n < 0 ? "abc" : "abc";
  const args: [string | undefined] = [value];
  return callback.apply(undefined, args);
}
export function callSubject(n: number): number {
  const callback = target as (value: string | undefined) => number;
  const value: string | undefined = n < 0 ? undefined : "abc";
  return callback.call(undefined, value);
}
export function callControl(n: number): number {
  const callback = target as (value: string | undefined) => number;
  const value: string | undefined = n < 0 ? "abc" : "abc";
  return callback.call(undefined, value);
}
export function boundSubject(n: number): number {
  const callback = target as (value: string | undefined) => number;
  const value: string | undefined = n < 0 ? undefined : "abc";
  return callback.bind(undefined, value)();
}
export function boundControl(n: number): number {
  const callback = target as (value: string | undefined) => number;
  const value: string | undefined = n < 0 ? "abc" : "abc";
  return callback.bind(undefined, value)();
}

// expect-ir: all: count erase in spreadSubject == 1
// expect-ir: all: count erase in applySubject == 1
// expect-ir: all: count erase in callSubject == 1
