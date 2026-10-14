// Typed arrays made with `new Array(n)` and written before they are read:
// filled by a loop counting up from zero to the array's own length, or read
// back at the index value just stored. Wasm holds them unboxed, with zeros
// where JavaScript would hold holes, so each read is proven to see a write.

class Ball {
  constructor(readonly x: number, readonly y: number) {}
}

export function counted(n: number): number {
  const count = (n & 7) + 1;
  const xs = new Array<number>(count);
  for (let i = 0; i < count; i++) xs[i] = n + i;
  let total = 0;
  for (let i = 0; i < count; i++) total = total * 3 + xs[i]!;
  return total;
}

export function constantLength(n: number): number {
  const xs: number[] = new Array(4);
  for (let i = 0; i < 4; i++) xs[i] = n * i;
  return xs[0]! + xs[3]! * 10;
}

export function objectsFromALoop(n: number): number {
  const count = (n & 3) + 2;
  const balls: Ball[] = new Array(count);
  for (let i = 0; i < count; i += 1) balls[i] = new Ball(n + i, i);
  let total = 0;
  for (let i = 0; i < count; i += 1) total = total * 3 + balls[i]!.x + balls[i]!.y;
  return total;
}

export function words(n: number): string {
  const count = (n & 3) + 1;
  const xs: string[] = new Array(count);
  for (let i = 0; i < count; i++) xs[i] = `w${i}`;
  return xs.join("-");
}

export function grid(n: number): number {
  const rows: number[][] = new Array(3);
  for (let i = 0; i < 3; i++) {
    const row: number[] = new Array(2);
    for (let j = 0; j < 2; j++) row[j] = n + i * 10 + j;
    rows[i] = row;
  }
  return rows[2]![1]! + rows[0]![0]!;
}

export function sameSlot(n: number): number {
  const xs: number[] = new Array(4);
  const at = n > 0 ? 1 : 2;
  xs[at] = n;
  return xs[at]!;
}
