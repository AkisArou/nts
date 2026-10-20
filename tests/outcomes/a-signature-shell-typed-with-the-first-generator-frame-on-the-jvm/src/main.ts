// run: check
// backend: jvm
//
// Two generator closures as the defaults of one array pattern, in an arrow
// held by a binding declared without a type and assigned later: test262 dstr
// `ary-ptrn-elem-id-init-fn-name-gen` and `obj-ptrn-id-init-fn-name-gen`
// (arrow-function and function), typed. Both closures fill one signature,
// whose call shell is declared with the first closure's own generator frame
// as its result (`declare func Fn__N#call(...) -> managed<generator#0>`,
// carrying the first closure's span), so the second's `call`, returning its
// own frame, does not override it and the JVM declines (NTS4009
// `Closure2.call`). A shell typed with the generator both frames extend
// would be a covariant return the JVM bridges (`narrows_return`). C, LLVM
// and Wasm call through the slot and agree with node. The one-change
// control, `...-control`, binds the arrow with `const`.
let calls = 0;
let f;
f = ([gen = function* () {}, xGen = function* x() {}]) => {
  calls = calls + 1;
};
f([]);

export function run(): number {
  return calls;
}
