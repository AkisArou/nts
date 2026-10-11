interface Face { readonly value: number; }
class Stored { value = 7; }
function unsupported(n: number): number { return eval("n") as number; }
function relay(n: number): number {
  if (n < 0) throw new Error("negative");
  return unsupported(n);
}
class Getter {
  private state = 9;
  get value(): number { return relay(this.state); }
}
function readFace(value: Face): number { return value.value; }
function caughtFace(value: Face): number {
  try { return value.value; } catch { return -1; }
}
export function unknownReceiver(n: number): number {
  const values: Face[] = [new Stored(), new Getter()];
  return readFace(values[n > 0 ? 0 : 1]!);
}
export function caughtReceiver(n: number): number {
  const values: Face[] = [new Stored(), new Getter()];
  return caughtFace(values[n > 0 ? 0 : 1]!);
}
export function provenReceiver(n: number): number { return new Stored().value + n; }
