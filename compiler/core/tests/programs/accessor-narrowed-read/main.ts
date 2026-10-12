interface Base { readonly flag?: boolean; }
interface Narrow extends Base { readonly flag: boolean; }
class Stored { readonly flag: boolean = true; }
class Computed { get flag(): boolean { return false; } }

function isNarrow(value: Base): value is Narrow {
  return typeof value.flag === "boolean";
}
export function flag(value: Base): boolean {
  return isNarrow(value) && value.flag;
}
export function observeFlag(n: number): boolean {
  if (n === 0) return flag(new Stored());
  if (n === 1) return flag(new Computed());
  return flag({});
}

interface NullableFace { readonly nullableFlag: boolean; }
class Nullable { get nullableFlag(): boolean | null { return null; } }

// The assertion cannot remove the concrete getter's real null result.
export function assertedRead(value: NullableFace): boolean {
  return value.nullableFlag;
}
export function observeNullable(): unknown {
  const value: NullableFace = new Nullable() as NullableFace;
  return value.nullableFlag;
}
