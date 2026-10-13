// expect: NTS1001 an `Object` static over something that is not an object here
//
// **`Object.keys` is refused over a value whose type is `object`.**
// `describe` takes its argument as `object` and lists its keys; the
// `Object.keys` call is the refused construct, though every value of type
// `object` is an object. The refusal cuts the two module-scope prints that
// call `describe`: the program prints nothing, and node prints
// `keys {a, b}` and `keys {}`. An `unknown` narrowed to an object by
// `typeof value === "object" && value !== null` is refused the same way.
//
// **Control**, measured and not kept in this file: the same program with the
// parameter typed `Record<string, unknown>`, a one-type difference. It
// compiles on all three compilers below and prints node's lines.
//
// Not a control: keeping the parameter `object` and casting at the call,
// `Object.keys(value as Record<string, unknown>)`. That compiles, and the
// program ends in SIGSEGV on bcf750d4b, even given plain objects: the family of
// outcomes/an-own-property-read-through-a-cast-of-an-object.
//
// **Measured the same** on 2e8eedb17, efc71ad44 and bcf750d4b.
//
// **Found by the React lane.** `throwOnInvalidObjectTypeImpl`
// (runtime/react/packages/react-reconciler/src/ReactChildFiber.ts:270) builds
// "Objects are not valid as a React child (found: object with keys {...})"
// with `Object.keys(newChild)`, `newChild: object`, as upstream does. Through
// `throwOnInvalidObjectType` it refuses `createChild`, `updateSlot`,
// `updateFromMap` and `reconcileChildFibersImpl`, the child reconciler's
// entry; today the build names the `Symbol.iterator` read
// (blockers/a-symbol-keyed-member-read-through-an-object-type) as their first
// cause.
function describe(value: object): string {
  return "keys {" + Object.keys(value).join(", ") + "}";
}

console.log(describe({ a: 1, b: 2 }));
console.log(describe({}));
