// A named function expression's name binding is immutable: assigning it
// must not replace the function (strict code throws, sloppy code ignores
// the write). The lowering treats it as an ordinary cell typed as the
// function and unerases the assigned number into that object type, so C
// reads on with a wrong value and Wasm refuses at run time ("an erased
// value read as an object of a type it is not"). The control reads the
// name without assigning it and agrees with node. From test262
// named-strict-error-reassign-fn-name-in-body (census 2026-10-19, pin
// 362b32f13: the other non-elision "read as an object" no-verdict).
import { run } from "./case.js";

for (const [label, value] of run()) observe(label, value);
done();
