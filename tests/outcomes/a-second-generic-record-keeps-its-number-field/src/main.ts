// A generic function returns a record whose type-parameter field precedes a
// number field. Called twice, the second record's number reads 0 on C and
// LLVM where node reads 7; the first call's is right. Under `nts check` the
// same function is refused with NTS2006 (an object type with no layout), so
// program code reads a field the backend has no layout for. One call, a
// number type argument, or the number field first agree on C and LLVM. The
// control replaces the type parameter with its argument's interface.
function compute<T>(input: T, r: number): { owner: T; result: number } {
  return { owner: input, result: r };
}
const first = compute({ base: 1 }, 7);
const second = compute({ base: 2 }, 7);
observe("first call", String(first.result));
observe("second call", String(second.result));
done();
