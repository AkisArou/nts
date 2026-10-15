// backend: jvm
// run: check
// The program is `case.js`: unchecked JavaScript, as test262 is.
//
// A generator passed to a function whose parameter is `[]`: the parameter is
// laid out as an iterable the generator class does not extend, and the JVM
// declines the store (NTS4001, a `Generator0` where an `Iterable<…>` is
// declared). C and LLVM store the pointer, and the empty pattern reads
// nothing, so they agree with node. test262 dstr `ary-ptrn-empty` and its
// relatives. There is no clean control: the same pattern over an array
// literal is invalid HIR on every backend.
export { probe } from "./case.js";
