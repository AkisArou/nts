// The control for tests/outcomes/a-generator-as-an-array-pattern-default-on-jvm:
// the same array pattern with a plain function as its default rather than a
// generator. Its signature's `#call` stays a declaration, and every backend
// agrees.
var f;
f = ([gen = function () {}]) => `gen ${gen.name}`;
const said: string = f([]);
export function name(n: number): string {
  return said + " " + String(n | 0);
}
