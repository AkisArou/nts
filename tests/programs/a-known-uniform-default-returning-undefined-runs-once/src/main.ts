// Main 547: 58/58 on C and Wasm. On 13e0 the subject is wrong 29/29:
// its known closure's caller fills the default, and the uniform entry applies
// it again because its result is undefined (102 instead of node's 101).
// The one-change control supplies the argument, so the default never runs.
export function subject(n: number): number {
  let effects = 0;
  const callback = (value: any = (effects++, undefined)): number =>
    (value === undefined ? 100 : 0) + effects;
  return callback();
}

export function control(n: number): number {
  let effects = 0;
  const callback = (value: any = (effects++, undefined)): number =>
    (value === undefined ? 100 : 0) + effects;
  return callback(n);
}
