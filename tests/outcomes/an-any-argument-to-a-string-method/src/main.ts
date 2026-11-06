// run: build
//
// String methods convert their arguments with ToString, so node prints
// "legonull" and "abcfalsefa". An argument typed `any` reaches nts as an erased
// value, and nts passes it unconverted to the runtime's string helper
// (`nts_concat`, `nts_str_pad_end`), which takes a string: the C compiler
// rejects the program nts emits ("incompatible type for argument 2 of
// 'nts_concat'"). JavaScript reaches the same helpers with null, undefined,
// booleans, numbers, symbols and objects: in the census of 2026-11-06 on pin
// e0395d27506b, 11 no-verdict test262 cases in String.prototype concat,
// padStart, padEnd and split, and one in TypedArray.prototype.join
// (`nts_view_join`), stop at the same kind of call. The control,
// an-any-argument-to-a-string-method-control, converts each argument with
// String() first and agrees. The defect stops the build, so the control is a
// fixture of its own.
const missing: any = null;
const fill: any = false;
observe("concat", "lego".concat(missing));
observe("padEnd", "abc".padEnd(10, fill));
done();
