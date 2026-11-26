// expect: NTS1001 `JSON.parse(text) as T` whose parsed objects' key order or
//         undeclared keys the program can observe, through an export
//
// A parsed `Point` handed to the host, which may enumerate it -- the
// differential prints a returned object's keys in their order. An export is a
// host boundary, so the parse counts as observed and is refused by name until
// #650's key order part (`hir/lower/json_parse.rs`, `Observers`).
interface Point {
  x: number;
  y: number;
}
export function parsed(n: number): Point {
  return JSON.parse('{"y":1,"x":' + n + ',"z":2}') as Point;
}
