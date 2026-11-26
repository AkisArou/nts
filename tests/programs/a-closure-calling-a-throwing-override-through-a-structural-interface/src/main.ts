// Guard for #872: a filler without an implements clause.
// narrowing a captured interface receiver to Base does not
// prove its dynamic class. A throwing Sub must retain raising virtual dispatch.
interface Runner { run(): number; }
class Base {
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
function throughInterface(value: Runner): number {
  return attempt(() => value.run());
}
export function face(n: number): number { return throughInterface(make(n)); }
