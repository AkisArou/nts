// A function type that only a value has, and no signature mentions.
//
// The checker makes a type id per written function type, so
// `(n: number) => number` is three ids below, and a layout exists for an id
// only once something asks for it -- which a signature does. The generic
// `identity` answers erased, and its answer is unerased to the declared
// result type of `functionIdentity`: an id nothing had asked about. The
// backend declined `functionValue` ("an object type with no layout"). Every
// function type the program holds a value of is laid out now, in the layout
// of its signature, which each closure of that signature extends -- the JVM's
// `checkcast` is the arm that shows the relation.
function identity<T>(value: T): T { return value; }

const functionIdentity: (value: (n: number) => number) => (n: number) => number = identity;
export function functionValue(n: number): boolean {
  const fn = (p: number) => p + n;
  const result = functionIdentity(fn);
  return result === fn && result(2) === n + 2;
}

/** The same type one level in, as an array's element. */
const listIdentity: (value: ((n: number) => number)[]) => ((n: number) => number)[] = identity;
export function elementValue(n: number): number {
  const fns = [(p: number) => p * 2, (p: number) => p - n];
  const result = listIdentity(fns);
  return result.length === 2 && result[0] === fns[0] ? result[0](n) + result[1](3) : -1;
}
