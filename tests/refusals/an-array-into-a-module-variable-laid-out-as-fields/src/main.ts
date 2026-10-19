// expect: NTS1001 an array where an anonymous object type is wanted
//
// An array assigned to a module variable declared as an object type: valid
// TypeScript, and an array keeps its elements in a block behind a length where
// `{ length: number }` is laid out as a field. A module variable is one slot
// with one representation; the array reached it unconverted and the verifier
// stopped the whole program at the store (`StoreType { func: "module#init",
// what: "a global", expected: Managed(Object(..)), found: Managed(Array(..)) }`).
// Now it is refused by name, and the rest of the module still compiles.
//
// Control, one difference -- the same array passed to a parameter of that
// type, `function f(x: { length: number }) { return x.length } f([1, 2, 3])`:
// it compiles, because the call is specialized for an array argument
// (`f@0arrf64`), which a module variable's one slot cannot be.
let g: { length: number } = { length: 0 };
g = [1, 2, 3];
