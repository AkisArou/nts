interface OptionalCallback {
  run?: ((n: number) => number) | undefined;
}

export function stored(n: number): number {
  const target: OptionalCallback = { run: (value: number) => value + 1 };
  return target.run?.(n) ?? -1;
}

export function missing(n: number): number {
  const target: OptionalCallback = {};
  let evaluated = 0;
  target.run?.(evaluated = 7);
  return n + evaluated;
}

export function explicitUndefined(n: number): number {
  const target: OptionalCallback = { run: undefined };
  let evaluated = 0;
  target.run?.(evaluated = 7);
  return n + evaluated;
}

function clear(target: OptionalCallback): void {
  target.run = undefined;
}

export function mutated(n: number): number {
  const target: OptionalCallback = { run: (value: number) => value + 1 };
  const before = target.run?.(n) ?? -1;
  clear(target);
  let evaluated = 0;
  const after = target.run?.(evaluated = 7) ?? -2;
  return before + after + evaluated;
}

export function identity(n: number): boolean {
  const target: OptionalCallback = { run: (value: number) => value + n };
  return target.run === target.run;
}

