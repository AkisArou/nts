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

interface DirectFace { readonly direct: number; }
class DirectStored { direct = 13; }
class DirectGetter {
  get direct(): number { return eval("19") as number; }
}
function readDirect(value: DirectFace): number { return value.direct; }
function caughtDirect(value: DirectFace): number {
  try { return value.direct; } catch { return -3; }
}
export function directUnknown(n: number): number {
  const values: DirectFace[] = [new DirectStored(), new DirectGetter()];
  return readDirect(values[n > 0 ? 0 : 1]!);
}
export function directCaught(n: number): number {
  const values: DirectFace[] = [new DirectStored(), new DirectGetter()];
  return caughtDirect(values[n > 0 ? 0 : 1]!);
}
export function directProven(n: number): number { return new DirectStored().direct + n; }
