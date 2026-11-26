// Guard for #872: a raising closure calls an interface supplied by a stored
// literal function as well as a quiet class. The class-body inventory cannot
// list the stored function, so that family must keep its raising slot.
interface Wakeable {
  then(resolve: () => unknown, reject: () => unknown): unknown;
}
interface Thenable<T> {
  then(resolve: (value: T) => unknown, reject: (error: unknown) => unknown): unknown;
}
class Quiet implements Wakeable {
  then(_resolve: () => unknown, _reject: () => unknown): unknown {
    return undefined;
  }
}
function attempt(run: () => number): number {
  try { return run(); } catch { return 17; }
}
function invoke(receiver: Wakeable, n: number): number {
  return attempt(() => {
    receiver.then(() => undefined, () => undefined);
    return n;
  });
}
export function caught(n: number): number {
  const receiver: Thenable<void> = {
    then: (resolve: (value: void) => unknown): void => {
      if (n < 0) throw new Error("bad");
      resolve(undefined);
    },
  };
  return invoke(receiver, n);
}
export function control(n: number): number {
  return invoke(new Quiet(), n);
}
