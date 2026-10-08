function boom(): number {
  throw new RangeError("boom");
}
class Holder {
  value = boom();
}
export function noCopy(n: number): number {
  if (n < 0) throw new RangeError("negative");
  return n > 100 ? new Holder().value : n * 3;
}
