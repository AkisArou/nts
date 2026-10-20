// backend: jvm
// run: check
// The program is `case.js`: unchecked JavaScript, as test262 is.
//
// A generator passed to a function whose parameter is `[]`: the parameter is
// laid out as an iterable the generator class does not extend, and the JVM
// declined the store (NTS4001, a `Generator0` where an `Iterable<…>` is
// declared). C and LLVM store the pointer, and the empty pattern reads
// nothing, so they agree with node. test262 dstr `ary-ptrn-empty` and its
// relatives. Held since the JVM refers to a face that promises nothing as
// the root (`types::root_typed` in compiler/codegen/jvm), so the store is an
// upcast. Its one-change control replaces [] with an ordinary parameter:
// tests/programs/a-generator-value-passed-to-an-ordinary-parameter. The array
// literal sibling is a separate recorded invalid-HIR case.
export { probe } from "./case.js";
