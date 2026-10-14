// expect: emit-c --napi -> emits-addon napi_set_named_property(env, exports, "pNumbers"
//
// **Four types cross the wrapper inward: `number`, `string`, `boolean` and
// `number[]`.** Fourteen functions, one parameter each, differing in nothing
// else:
//
//     number          ok            Uint8Array      takes TypedArray, which
//     string          ok                            crosses outward only
//     boolean         ok            Uint8Array[]    takes TypedArray[]
//     number[]        ok            Row             takes an object, which
//                                                   crosses outward only
//     string[]        takes string[]  Row[]         takes an object[]
//     boolean[]       takes bool[]    Row | null    takes an object
//     (a: number)=>n  not compiled    number|string  takes unknown
//                                     v?: number     takes unknown
//
// The four that cross are the controls. `pNumbers` is the expectation because
// it is the least obvious of them -- an array *does* cross, so the declines
// above are element kinds and parameter shapes the boundary was not given,
// not "arrays do not cross".
//
// **`v?: number` reads as `takes unknown`.** An optional number is the shape
// node uses everywhere -- `timers.setTimeout(after?: number)`,
// `stream.find(options?: OperatorOptions)`, `fs.cp(suppliedCallback?: Callback)`
// -- and it is the same decline as a genuine `unknown`.
//
// **Roughly 335 exported functions have at least one parameter that cannot
// cross**, concentrated in `fs` 122, `stream` 69, `zlib` 40, `timers` 17,
// `url` 15, `process` 14. That figure is a characterisation and not a precise
// count: the classifier reads a capitalised annotation as an object, and some
// of those are aliases for unions or views, so the split between categories
// moves while the total does not.
//
// The outward side is `array-return-only-carries-numbers` and
// `view-returns.py`. A `Uint8Array` crossing *outward only* is why
// `string_decoder.write(buf)` cannot be called even once the class publishes.

interface Row {
  name: string;
  size: number;
}
type Fn = (a: number) => number;

export function pNumber(v: number): number { return v; }
export function pString(v: string): number { return v.length; }
export function pBool(v: boolean): number { return v ? 1 : 0; }
export function pNumbers(v: number[]): number { return v.length; }

export function pStrings(v: string[]): number { return v.length; }
export function pBools(v: boolean[]): number { return v.length; }
export function pView(v: Uint8Array): number { return v.byteLength; }
export function pViews(v: Uint8Array[]): number { return v.length; }
export function pObject(v: Row): number { return v.size; }
export function pObjects(v: Row[]): number { return v.length; }
export function pFn(v: Fn): number { return v(1); }
export function pOptional(v?: number): number { return v ?? 0; }
export function pUnion(v: number | string): number {
  return typeof v === "string" ? v.length : v;
}
export function pNullable(v: Row | null): number { return v === null ? 0 : v.size; }
