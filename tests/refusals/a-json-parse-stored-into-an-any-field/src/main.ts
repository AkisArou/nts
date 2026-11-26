// expect: NTS1001 `JSON.parse(text) as T` whose parsed objects' key order or
//         undeclared keys the program can observe, through a store into an
//         erased place
//
// A parsed `Point` stored into an `any` field, from where anything may read
// it -- an erased value's keys are its own object's, in its own order. The
// store is a boundary the type does not follow, so the parse counts as
// observed and is refused by name until #650's key order part
// (`hir/lower/json_parse.rs`, `Observers`).
interface Point {
  x: number;
  y: number;
}
const holder: { value: any } = { value: 0 };
export function parsed(n: number): number {
  holder.value = JSON.parse('{"y":1,"x":' + n + ',"z":2}') as Point;
  return n;
}
