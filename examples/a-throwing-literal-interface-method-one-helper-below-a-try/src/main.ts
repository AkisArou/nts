// Calls through a helper must use the same raising interface family as
// directly guarded calls. Negative inputs throw; the positive control does not.
interface Wakeable { then(resolve: () => unknown, reject: () => unknown): unknown }
function invoke(value: Wakeable): number {
  value.then(() => undefined, () => undefined);
  return 11;
}
function run(value: Wakeable): number {
  try { return invoke(value); } catch { return 17; }
}
interface Thenable<T> { then(resolve: (value: T) => unknown, reject: (error: unknown) => unknown): unknown }
export function caught(n: number): number {
 const value: Thenable<void> = { then: (resolve: (value: void) => unknown): void => { if (n < 0) throw new Error("bad"); resolve(undefined); } };
 return run(value);
}

export function control(n: number): number {
  const quiet: Thenable<void> = { then: (): void => {} };
  return run(quiet) + n;
}
