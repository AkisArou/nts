// A class binding is a mutable `let`-like binding: assigning it a number
// and reading it back must answer the number. The lowering unerases the
// assigned value into the class's own object type instead of widening the
// binding, so C reads a number's bits as an object and Wasm refuses at run
// time ("an erased value read as an object of a type it is not"). The
// control constructs through the binding before any reassignment and
// agrees with node. From test262 eval-gtbndng-local-bndng-cls (census
// 2026-10-19, pin 362b32f13: one of the two Wasm "read as an object"
// no-verdicts outside the elision family).
import { run } from "./case.js";

for (const [label, value] of run()) observe(label, value);
done();
