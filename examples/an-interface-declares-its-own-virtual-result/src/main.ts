// An interface's method declares its own result, whichever implementer the
// compiler lowers first.
//
// `interface Producer { read(): unknown }` is a dispatch slot, and its
// declaration was copied from an implementer, return type included. With
// `Optional` (answering `string | undefined`) lowered before `Fallback`
// (answering `unknown`), the slot was declared to answer a string, and the
// call through `Producer` assigned an `NtsString *` to an `NtsValue`: clang
// refused the program. Written the other way round it compiled and answered
// wrongly, which is what a-nullable-virtual-return-keeps-its-absence pins.
// Every entry now answers what the slot does, erased, through a bridge.
interface Producer { read(n: number): unknown; }
class Optional implements Producer {
  read(n: number): string | undefined { return n > 0 ? "opt" : undefined; }
}
class Fallback implements Producer {
  read(n: number): unknown { return n; }
}
function read(producer: Producer, n: number): unknown { return producer.read(n); }
function score(value: unknown): number {
  if (value === undefined) return 1;
  if (value === null) return 2;
  return typeof value === "string" ? 10 + value.length : typeof value === "number" ? 100 + value : -99;
}
export function optional(which: number, n: number): number {
  const producer: Producer = which === 0 ? new Fallback() : new Optional();
  return score(read(producer, n));
}
