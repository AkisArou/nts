// The declaration alone compiles. It is the instantiating call that refuses,
// which is why the fixture is two files and why main.ts calls this twice.
const queue: (() => void)[] = [];

export function nextTick<A extends unknown[]>(
  callback: (...args: A) => void,
  ...args: A
): void {
  queue.push(() => callback(...args));
}
