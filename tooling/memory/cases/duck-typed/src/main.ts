// Duck-typing an `unknown`, in a loop.
//
//     value !== null && typeof value === "object" && "message" in value
//
// Three tests and no allocation: a tag comparison for the null, a tag
// comparison for the `typeof`, and a descriptor comparison for the `in`. The
// `in` is the interesting one — it is answered from the closed set of types
// that declare the name, so it is a load of a header field and a pointer
// compare, and the alternative it replaced would have been a property table in
// every descriptor and a runtime walk of it.
//
// What this is aimed at is the narrowing rather than the cost. The checker
// narrows `unknown` to `{}` after `!== null`, and reading the payload through
// that was a *cast* — sound-looking, unchecked on a lane with pointers, and a
// `ClassCastException` on the one that checks. Reading the tag instead
// allocates nothing and cannot lie, and a lowering that went back to the cast
// would still read zero here: this case cannot catch that one, which is why
// the fixture that does is `examples/in-operator` on the JVM.

class Messaged {
  message = 1;
}

class Coded {
  code = 1;
}

function hasMessage(value: unknown): boolean {
  return value !== null && typeof value === "object" && "message" in value;
}

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i = i + 1) {
    const v: unknown = i % 2 === 0 ? new Messaged() : new Coded();
    total = (total + (hasMessage(v) ? 1 : 0)) | 0;
  }
  return total;
}
