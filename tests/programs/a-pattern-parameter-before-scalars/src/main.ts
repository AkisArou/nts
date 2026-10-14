function combine([value]: number[], offset: number, scale: number): number {
  return value + offset * 10 + scale;
}
function skip([value]: number[], ignored: number, offset: number): number {
  return value + offset;
}
export function ordered(n: number): number { return combine([n], 2, 3); }
export function swapped(n: number): number { return combine([n], 3, 2); }
export function unused(n: number): number { return skip([n], 99, 5); }
export function direct([value]: number[], offset: number, scale: number): number {
  return value + offset * 10 + scale;
}
export function repeat([value]: number[], scale: number): number {
  let total = 0;
  for (let i = 0; i < 3; i++) total += value * scale;
  return total;
}
export function guarded(n: number): number { return repeat([2], n); }
class Box { constructor(public amount: number, public label: string) {} }
class Holder {
  public offset: number;
  constructor([value]: number[], public box: Box) { this.offset = value; }
}
export function owned(n: number): number {
  const box = new Box(n, "owned " + n);
  const holder = new Holder([n + 1], box);
  return holder.box === box ? holder.offset + holder.box.amount : -1;
}
