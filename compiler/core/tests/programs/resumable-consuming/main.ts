let saved: number[] | null = null;

function nestedThrow(shouldThrow: boolean): void {
  let value = 0;
  for (let i = 0; i < 3; i++) value += i;
  if (shouldThrow && value === 3) throw undefined;
}

function relayThrow(shouldThrow: boolean): void {
  for (let i = 0; i < 3; i++) if (i === 2) nestedThrow(shouldThrow);
}

function quietRead(xs: number[]): number {
  let value = 0;
  for (let i = 0; i < xs.length; i++) value += xs[i];
  return value;
}

function storeAfterRelay(xs: number[], mode: number): number {
  relayThrow(mode < 0);
  saved = xs;
  relayThrow(mode > 0);
  return xs[0];
}

function storeAfterQuietRead(xs: number[], mode: number): number {
  const result = quietRead(xs);
  saved = xs;
  return result + mode;
}

export class Keeper {
  keep(xs: number[], mode: number): number {
    return storeAfterRelay(xs, mode);
  }

  quiet(xs: number[], mode: number): number {
    return storeAfterQuietRead(xs, mode);
  }
}

const keeper = new Keeper();
export function published(xs: number[], mode: number): number {
  return keeper.keep(xs, mode);
}
export function read(): number {
  return saved === null ? -1 : saved[0];
}
export function work(n: number): number {
  const mode = n < 0 ? -1 : n > 0 ? 1 : 0;
  return keeper.keep([n], mode) + keeper.quiet([n], mode) + read();
}
