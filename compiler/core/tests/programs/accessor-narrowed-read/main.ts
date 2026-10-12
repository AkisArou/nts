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

interface QueryFace { query?: string | number[] | null; }
class Query {
  query: string | number[] | null = null;
  constructor(n: number) { this.query = [n]; }
  read(): number { return readQuery(this); }
}
function arraySize(value: number[]): number { return value.length; }
function readQuery(value: QueryFace): number {
  if (value.query !== null && value.query !== undefined && typeof value.query === "object") {
    return arraySize(value.query);
  }
  return 0;
}
export function observeQuery(n: number): number { return new Query(n).read(); }
