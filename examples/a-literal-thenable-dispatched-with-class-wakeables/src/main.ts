interface Wakeable { then(resolve: () => unknown, reject: () => unknown): unknown }
interface Thenable<T> { then(resolve: (value: T) => unknown, reject: (error: unknown) => unknown): unknown; status?: string }
interface RejectedThenable<T> extends Thenable<T> { status: string; reason: unknown }
class NoListeners { then(): void {} }
class OneListener { then(listener: () => void): void { listener(); } }
function listen(value: Wakeable, n: number): number {
  let out = 0;
  value.then(() => { out += n + 1; }, () => { out += n + 2; });
  return out;
}
function guarded(value: Wakeable): number {
  try {
    value.then(() => undefined, () => undefined);
    return 11;
  } catch {
    return 17;
  }
}
export function caught(n: number): number {
  const value: Thenable<void> = {
    then: (resolve: (value: void) => unknown): void => {
      if (n < 0) throw new Error("bad");
      resolve(undefined);
    },
  };
  return guarded(value);
}
export function result(n: number): number {
  const captured: Thenable<void> = { then(resolve: (value: void) => unknown): void { resolve(undefined); } };
  const empty: Thenable<unknown> = { then(): void {} };
  const rejected: RejectedThenable<unknown> = { status: "rejected", reason: "bad", then(): void {} };
  const all: Wakeable[] = [captured, empty, rejected, new NoListeners(), new OneListener()];
  let sum = 0;
  for (const item of all) sum += listen(item, n);
  return sum;
}
