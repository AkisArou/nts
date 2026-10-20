// `++x` where `x` holds an object must answer NaN (ToNumber of the object).
// The lowering reads the erased global straight back as an f64 -- no
// ToNumber dispatch of the kind a numeric read gets (the isNaN read below
// lowers with the full tag dispatch in the same program) -- so C answers
// with the value's payload read as a double and Wasm refuses at run time
// ("an erased value read as a number, which it is not"). The control
// differs only in the held kind and agrees with node. From test262
// S11.4.4_A3_T5 and its five prefix/postfix siblings (census 2026-10-19,
// pin 362b32f13: the six Wasm "read as a number" no-verdicts).
let held: any = 41;
++held;
observe("number control", String(held));
held = { v: 1 };
++held;
observe("object value", String(isNaN(held)));
done();
