// expect: reading literal method `take` as a value through another interface is not supported
// A scalar argument keeps the source copy's actual owner. An array element
// has lost that owner, so this call needs an accessor returning its own closure.
interface Sink { take(x: number): number }
interface Wide { take(x: number | string): number }
function same(sink: Sink): boolean { return sink.take === sink.take; }
export function result(n: number): boolean {
  const literal: Wide = { take(_x: number | string): number { return n; } };
  const faces: Sink[] = [literal];
  return same(faces[0]);
}
