// expect: NTS1001 `JSON.parse(text) as T` whose parsed objects' key order or
//         undeclared keys the program can observe, through `Object`'s own-key
//         reflection
//
// A parsed `Point` reaches `Object.keys` through a generic helper: its operand
// is a type parameter, which may be anything, so the parse counts as
// observed. Node prints the text's order, `y,x,z` with the undeclared `z`,
// and a reader keeps neither, so this is refused by name until #650's key
// order part keeps them (`hir/lower/json_parse.rs`, `Observers`). Without
// this guard it would print the layout's `x,y` and agree with node only by
// luck of the text's order.
//
// The control is tests/programs/a-json-parse-as-a-plain-object-builds-its-layout,
// which parses the same way and enumerates nothing.
interface Point {
  x: number;
  y: number;
}
function keysOf<U extends object>(value: U): string {
  return Object.keys(value).join(",");
}
export function parsed(n: number): string {
  return keysOf(JSON.parse('{"y":1,"x":' + n + ',"z":2}') as Point);
}
