// Guard for #872: a Base-typed capture can hold a Sub.
// A quiet base method must retain its throwing override's raising dispatch.
interface Runner { run(): number; }
class Base implements Runner {
  run(): number { return 1; }
}
class Sub extends Base {
  override run(): number { throw new RangeError("x"); }
}
function make(n: number): Base {
  return n < 0 ? new Sub() : new Base();
}
function attempt(run: () => number): number {
  try { return run(); } catch { return -1; }
}
function throughBase(value: Base): number {
  return attempt(() => value.run());
}
export function base(n: number): number { return throughBase(make(n)); }
