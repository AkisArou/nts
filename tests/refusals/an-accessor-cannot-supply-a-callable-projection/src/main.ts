// expect: NTS1001 `Accessor` where `PlainMaybe` is wanted
// Control: getterStorageControl in a-stored-optional-callback-receives-its-object.
// Only get run -> run storage changes which supplier can satisfy the view.
interface PlainMaybe { run?: ((n: number) => number) | undefined; }
function increment(n: number): number { return n + 1; }
class PlainMethod { run(n: number): number { return n + 1; } }
class Accessor { get run(): (n: number) => number { return increment; } }
function plainChoice(accessor: boolean): PlainMaybe {
  if (accessor) return new Accessor();
  return new PlainMethod();
}
export function accessorReceiver(n: number): number {
  return plainChoice((n & 1) !== 0).run?.(n) ?? -1;
}
