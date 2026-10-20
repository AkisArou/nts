// `Promise.all` over each kind of result its array can hold. The C runtime
// stored a settled value as a reference if the array held references and as a
// `double` otherwise: an erased array (16-byte tagged values) read every
// element back as `undefined`, and a boolean array (a byte a slot) took eight
// bytes a slot, so three booleans wrote 24 bytes into 3 and the program died of
// the heap it corrupted. test262's `elements/*-rs-static-async-method-
// privatename-*` cases await six erased results through one `Promise.all`,
// which is how it was found once their C compiled.
//
// **C only, as this harness is.** As a tests/programs/ fixture the same
// program agrees on C and LLVM, and not yet elsewhere: the JVM has no boolean
// `NtsPromise.all` and stores strings into the wrong array type, and Wasm
// misreads the results. It moves there once both agree.
//
// The control is `numbers`: doubles into a double array, which agreed.
async function settle<T>(value: T): Promise<T> {
  return await value;
}
Promise.all([settle(1), settle(2), settle(4)])
  .then((r) => {
    observe("numbers", `${r[0] + r[1] * 10 + r[2] * 100}`);
    return Promise.all([settle("a"), settle("b")]);
  })
  .then((r) => {
    observe("strings", r.join(""));
    return Promise.all([settle<any>(3), settle<any>("s"), settle<any>(true)]);
  })
  .then((r) => {
    observe("erased", `${r[0]},${r[1]},${r[2]}`);
    return Promise.all([settle(true), settle(false), settle(true)]);
  })
  .then((r) => {
    observe("booleans", r.map((b) => (b ? "t" : "f")).join(""));
    done();
  });
