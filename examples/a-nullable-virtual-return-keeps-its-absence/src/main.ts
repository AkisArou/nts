// A string result with its absence, through an erased virtual root, and the
// same through a subclass that re-overrides it at the same type.
//
// `Producer#read` answers `unknown` and each override a nullable string, so
// the slot answers erased and every override's entry is a bridge
// (`Optional#read@erased`) that erases what its body returned -- a null
// pointer as `undefined` or `null` by the absence the override's own checker
// type gives. `FurtherOptional` and `FurtherNullable` have bridges of their
// own; answered through a parent's, a null proved `null` would be packaged as
// that parent decides. Each pair's re-override returns a value a different
// input chooses, so a parent body answering for its child shows.
interface Producer {
  read(n: number): unknown;
}
class Fallback implements Producer {
  read(n: number): unknown { return n; }
}
class Optional implements Producer {
  read(n: number): string | undefined { return n > 0 ? "opt" : undefined; }
}
class FurtherOptional extends Optional {
  override read(n: number): string | undefined { return n > 1 ? "further-opt" : undefined; }
}
class Nullable implements Producer {
  read(n: number): string | null { return n > 0 ? "nul" : null; }
}
class FurtherNullable extends Nullable {
  override read(n: number): string | null { return n > 1 ? "further-nul" : null; }
}
function read(producer: Producer, n: number): unknown {
  return producer.read(n);
}
function score(value: unknown): number {
  if (value === undefined) return 1;
  if (value === null) return 2;
  return typeof value === "string" ? 10 + value.length : -99;
}
export function optional(which: number, n: number): number {
  const producer: Producer = which === 0 ? new Fallback() : which === 1 ? new Optional() : new FurtherOptional();
  return score(read(producer, n));
}
export function nullable(which: number, n: number): number {
  const producer: Producer = which === 0 ? new Fallback() : which === 1 ? new Nullable() : new FurtherNullable();
  return score(read(producer, n));
}
