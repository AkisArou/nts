// A generator function as the default of an array pattern element, read for
// its name and never called: test262's dstr `*-elem-id-init-fn-name-gen`,
// reduced by the JVM lane, and the guard of its fix.
//
// The arrow `f`'s signature takes typed calls (59a9a8288), which made every
// closure-slot entry reachable, the generator default's own signature
// declaration among them. That declaration was made from the generator
// closure's `#call` and kept its frame, so `suspend` split it into the
// generator's entry: a body storing the signature value into the frame's field
// for the closure, which the JVM refused (NTS4001) and C stored unchecked. A
// declaration no longer carries a frame. The control, a plain function in the
// same place, is tests/programs/a-function-as-an-array-pattern-default.
var f;
f = ([gen = function* () {}]) => `gen ${gen.name}`;
const said: string = f([]);
export function name(n: number): string {
  return said + " " + String(n | 0);
}
