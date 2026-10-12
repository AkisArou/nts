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

// `shift` takes the first element and moves the rest down one slot.
function counted(n: number, x: number): number[] {
  const a: number[] = [];
  for (let i = 0; i < n; i++) a.push(x + i);
  return a;
}
export function shiftOrDefault(n: number, x: number): number {
  return counted(n, x).shift() ?? -1;
}
export function shiftAsserted(n: number, x: number): number {
  return counted(n, x).shift()!;
}
export function shiftThenRead(n: number, x: number, at: number): number {
  const a = counted(n, x);
  a.shift();
  a.push(-7);
  return a[at] + a.length * 1000;
}
export function shiftText(n: number, at: number): number {
  const words = ['a', 'bb', 'ccc', 'dddd'];
  const a: string[] = [];
  for (let i = 0; i < n; i++) a.push(words[i & 3]);
  const first = a.shift();
  return (first === undefined ? -1 : first.length) + (at < a.length ? a[at].length : 0) * 100;
}
