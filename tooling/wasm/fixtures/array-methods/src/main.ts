export function fillRoundtrip(n: number, x: number): number {
  const a = new Array<number>(n).fill(x);
  return a[0];
}

export function trimAfterFill(n: number, x: number): number {
  const a = new Array<number>(4).fill(x);
  const alias = a;
  a.length = n;
  a.push(x);
  return alias.length;
}

export function numericPop(x: number): number {
  const a: number[] = [];
  a.push(x);
  return a.pop() ?? -1;
}

export function clearHoles(n: number, x: number): number {
  const a = new Array<number>(n);
  a.length = 0;
  a.push(x);
  return a[0];
}
