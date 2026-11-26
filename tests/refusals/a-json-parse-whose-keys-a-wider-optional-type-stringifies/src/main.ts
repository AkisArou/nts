// expect: NTS1001 `JSON.parse(text) as T` whose parsed objects' key order or
//         undeclared keys the program can observe, through `JSON.stringify`
//
// A parsed `P` handed to a parameter typed `{ a: number; c?: string }`, which
// `P` is assignable to though it has no `c`: an optional member does not stop
// the assignment. `JSON.stringify` of that parameter writes the parsed
// object's keys in the text's order, `{"b":"x","a":1.5,"z":2}` in node, with
// the undeclared `z`; a reader keeps neither, so the parse counts as observed
// and is refused by name until #650's key order part
// (`hir/lower/json_parse.rs`, `reaches`). When only the type's every name
// counted, this compiled and wrote `{"a":1.5,"b":"x"}`.
//
// The control is tests/programs/a-json-parse-as-a-plain-object-builds-its-layout,
// which parses the same way and observes no keys.
interface P {
  a: number;
  b: string;
}
function written(value: { a: number; c?: string }): string {
  return JSON.stringify(value);
}
export function parsed(n: number): string {
  return written(JSON.parse('{"b":"x","a":' + n + ',"z":2}') as P);
}
