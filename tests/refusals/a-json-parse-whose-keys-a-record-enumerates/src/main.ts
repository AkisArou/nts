// expect: NTS1001 `JSON.parse(text) as T` whose parsed objects' key order or
//         undeclared keys the program can observe, through `Object`'s own-key
//         reflection
//
// A parsed `Point` read as a `Record<string, number>`, whose keys
// `Object.keys` lists: an index-signature operand may hold any object, so the
// parse counts as observed and is refused by name until #650's key order part
// (`hir/lower/json_parse.rs`, `Observers`). Node answers `y,x,z`.
type Point = { x: number; y: number };
function count(table: Record<string, number>): string {
  return Object.keys(table).join(",");
}
export function parsed(n: number): string {
  return count(JSON.parse('{"y":1,"x":' + n + ',"z":2}') as Point);
}
