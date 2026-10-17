// Clean75a baseline: C/LLVM/JVM abort 12/116, with 104 compared;
// Wasm declines 12/116, with 104 compared (partial agreement). Controls agree.
// Undefined and a present string share pointer storage here. The argument's
// source type must survive erasure, and neither known identity nor a typed
// signature may bypass the implementation's default. Each control changes
// only the undefined arm to a present string.
function target(value: string = "missing"): number { return value.length; }

export function knownSubject(n: number): number {
  const callback = target as (value: string | undefined) => number;
  const value: string | undefined = n < 0 ? undefined : "abc";
  return callback(value);
}
export function knownControl(n: number): number {
  const callback = target as (value: string | undefined) => number;
  const value: string | undefined = n < 0 ? "abc" : "abc";
  return callback(value);
}
export function sharedSubject(n: number): number {
  const callback: (value: string | undefined) => number = n < 0
    ? ((value: string = "missing"): number => value.length)
    : ((value: string = "another"): number => value.length);
  const value: string | undefined = n < 0 ? undefined : "abc";
  return callback(value);
}
export function sharedControl(n: number): number {
  const callback: (value: string | undefined) => number = n < 0
    ? ((value: string = "missing"): number => value.length)
    : ((value: string = "another"): number => value.length);
  const value: string | undefined = n < 0 ? "abc" : "abc";
  return callback(value);
}

// expect-ir: all: count erase in knownSubject == 1
// expect-ir: all: count erase in sharedSubject == 1
// expect-ir: all: no erase in knownControl
// expect-ir: all: no tagof in knownControl
// expect-ir: all: no call.extern(nts_refused) in knownControl
