// invalid HIR: `ReturnType { func: "maybe", block: BlockId(0), expected: Erased,
// found: None }`. A bare `return;` in a function declared to return a union
// the program erases (`number | undefined`): the return carries no value where
// the erased union wants one, so the verifier refuses and `emit-c` writes
// nothing for the whole program. Found by test262's return/S12.9_A5.js, the
// one case of its kind among 29,586.
//
// Controls, each measured as compiling: the same bare `return;` in a function
// with no declared return type (void), and `return undefined;` in this one.
// They are not arms here because invalid HIR costs the whole program.
function maybe(): number | undefined {
  return;
}
observe("maybe", String(maybe()));
done();
