// `e instanceof Array` and `e instanceof Object`.
//
// **Neither is a class here and neither can be.** An array is a runtime object
// with a length and no layout, and `Object` is not a declaration at all — so
// the class search in `lower_instanceof` has nothing to find, and the refusal
// that followed, *"an `instanceof` against something this compiler has no class
// for"*, was true about the representation and useless about the question. The
// same argument `instanceof_native` already makes for a typed array, where all
// nine share one struct and one descriptor.
//
// Answered **statically**, because in one compiled program there are no realms:
// every array is an `Array`, nothing that is not an array can be one, and
// neither name can be subclassed here. 16 files of the slice-1 `test/language`
// population reach the refusal — 7 `Array`, 7 `Object`, one each of `RegExp`
// and `Function`, and the last two stay refused.
//
// # The primitive/object line, and how it is even reachable
//
// `instanceof Object` is not a class test: it asks whether a value is an object
// at all, and a **string** and a **symbol** are managed values in this compiler
// and *primitives* in the language. So `"text" instanceof Object` is `false`.
//
// That arm looks unreachable and is not, which took measuring. TypeScript
// rejects a primitive left operand outright — `TS2358 The left-hand side of an
// 'instanceof' expression must be of type 'any', an object type or a type
// parameter` — so no direct spelling gets there. **A type parameter does**:
// `isObject<T>(x: T)` is specialized per instantiation, so `isObject("text")`
// reaches the lowering with a `Managed(String)` operand. Node answers `false`
// for it and `true` for an array, which is what `throughATypeParameter` pins.
//
// An **erased** operand keeps refusing: that needs the value's tag at run time,
// and answering it statically would be a guess about a value whose type the
// program deliberately did not fix.

const numbers: number[] = [1, 2, 3];
const nested: number[][] = [[1]];

export function anArrayIsAnArray(n: number): number {
  return (numbers instanceof Array ? 1 : 0) + (n < 1 ? 0 : 0);
}

/** Element type does not enter into it, at either depth. */
export function whateverItHolds(n: number): number {
  const a = nested instanceof Array ? 1 : 0;
  const b = nested[n < 1 ? 0 : 0] instanceof Array ? 1 : 0;
  return a * 10 + b;
}

// A plain field rather than a parameter property: node runs the oracle with
// `--experimental-strip-types`, which cannot erase `constructor(readonly x)`,
// so the differential would refuse the file rather than disagree with it.
class Point {
  x = 1;
}

/** A class instance is an `Object` and is not an `Array`. */
export function aClassInstance(n: number): number {
  const p = new Point();
  const a = p instanceof Array ? 1 : 0;
  const b = p instanceof Object ? 1 : 0;
  return a * 10 + b;
}

export function anArrayIsAnObject(n: number): number {
  return (numbers instanceof Object ? 1 : 0) + (n < 1 ? 0 : 0);
}

function isObject<T>(x: T): boolean {
  return x instanceof Object;
}

function isArray<T>(x: T): boolean {
  return x instanceof Array;
}

/**
 * The only route to a **primitive** operand, and the arm that fails if the rule
 * reads "anything managed is an object". Node answers `0` for the string and
 * `1` for the array.
 */
export function throughATypeParameter(n: number): number {
  const s = isObject(n < 1 ? "text" : "other") ? 1 : 0;
  const a = isObject([1, 2]) ? 1 : 0;
  const t = isArray("text") ? 1 : 0;
  const b = isArray([1, 2]) ? 1 : 0;
  return s * 1000 + a * 100 + t * 10 + b;
}

/**
 * The control: `instanceof` against a class the program declares goes through
 * the ordinary hierarchy search and must keep working. A change that answered
 * every `instanceof` from the left operand's representation would pass every
 * arm above and get this one wrong.
 */
export function anOrdinaryInstanceof(n: number): number {
  const p = new Point();
  return p instanceof Point ? 1 : 0;
}

class Derived extends Point {}

/** And the subclass relation, which is the reason the hierarchy search exists. */
export function throughTheHierarchy(n: number): number {
  const d = new Derived();
  const a = d instanceof Point ? 1 : 0;
  const b = d instanceof Derived ? 1 : 0;
  const p = new Point();
  const c = p instanceof Derived ? 1 : 0;
  return a * 100 + b * 10 + c;
}
