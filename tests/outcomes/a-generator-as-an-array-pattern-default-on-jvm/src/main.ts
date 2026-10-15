// backend: jvm
// run: check
// A generator function as the default of an array pattern element, read for
// its name and never called: test262's dstr `*-elem-id-init-fn-name-gen`,
// reduced. The default's own function type is a signature layout with one
// closure under it, and since the typed signatures landed (59a9a8288) that
// signature's `#call` carries the generator's body -- it builds the
// generator's frame and stores the signature value into the frame's field
// for the closure. The JVM declines that store (NTS4001: a `Fn…` where a
// `Closure…` is declared); C and LLVM store it unchecked. On main before
// 59a9a8288 the signature declared only `erased_call` and this agreed on the
// JVM. The control, a plain function in the same place, is
// tests/programs/a-function-as-an-array-pattern-default.
var f;
f = ([gen = function* () {}]) => `gen ${gen.name}`;
const said: string = f([]);
export function name(n: number): string {
  return said + " " + String(n | 0);
}
