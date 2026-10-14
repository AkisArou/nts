// An export answering a promise answers a JS promise: settled at once when the
// export's own checkpoint settled it, else watched until another export's
// checkpoint does. A rejection with a string crosses; one with a compiled
// Error is refused by name, since it needs an identity bridge.
const releases: Array<(value: number) => void> = [];

export async function settledNow(n: number): Promise<number> {
  return n * 2;
}

export function later(n: number): Promise<number> {
  return new Promise<number>(resolve => {
    releases.push((value: number) => resolve(value + n));
  });
}

export function settle(value: number): number {
  const release = releases.pop();
  if (release) release(value);
  return value;
}

export async function rejectsWithText(n: number): Promise<number> {
  if (n > 0) throw "positive";
  return n;
}

export async function rejectsWithError(n: number): Promise<number> {
  if (n > 0) throw new Error("positive");
  return n;
}
