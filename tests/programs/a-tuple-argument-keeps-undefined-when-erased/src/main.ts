// A tuple position's source type must survive coercion to an erased parameter.
// The controls change only the undefined arm to a present string.
// On clean 75a12a03f02a and ee62451842a7, C compares 116/4 with 12 wrong
// answers; Wasm declines those 12 and compares 104/116. Present controls agree.
// On ee624, changing only the callback type's `any` to `string | undefined`
// agrees on all 116 cases on both backends. No string contents are read here:
// the result observes only whether the implementation's default ran.
let defaults = 0;

function target(value: any = (defaults++, "missing")): number {
  return defaults;
}

export function spreadSubject(n: number): number {
  defaults = 0;
  const callback: (value: any) => number = target;
  const value: string | undefined = n < 0 ? undefined : "abc";
  const args: [string | undefined] = [value];
  return callback(...args);
}

export function spreadControl(n: number): number {
  defaults = 0;
  const callback: (value: any) => number = target;
  const value: string | undefined = n < 0 ? "abc" : "abc";
  const args: [string | undefined] = [value];
  return callback(...args);
}

export function applySubject(n: number): number {
  defaults = 0;
  const callback: (value: any) => number = target;
  const value: string | undefined = n < 0 ? undefined : "abc";
  const args: [string | undefined] = [value];
  return callback.apply(undefined, args);
}

export function applyControl(n: number): number {
  defaults = 0;
  const callback: (value: any) => number = target;
  const value: string | undefined = n < 0 ? "abc" : "abc";
  const args: [string | undefined] = [value];
  return callback.apply(undefined, args);
}
