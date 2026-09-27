// invalid HIR: `FellThrough { func: "pick", block: BlockId(2) }`. A function
// that returns a value on one path and falls off its end on another -- its
// return type `number | undefined`, inferred or declared -- has no `undefined`
// produced at the end, so the block falls through and `emit-c` writes nothing
// for the whole program. Strings and loops alike. The runtime never meets it
// because its sources return explicitly; test262 is JavaScript and does: four
// for-in/return files (an IIFE whose loop body always returns).
//
// Likely one gap with `a-bare-return-in-a-function-returning-a-union`, whose
// `return;` is the same missing `undefined` written out -- a `ReturnType`
// there, a `FellThrough` here. Two fixtures so a fix for one is seen to reach
// the other or not.
//
// Control, measured as compiling: the same function ending `return
// undefined;`. Not an arm here because invalid HIR costs the whole program.
function pick(c: boolean) {
  if (c) return 42;
}
observe("taken", String(pick(true)));
observe("fell off", String(pick(false)));
done();
