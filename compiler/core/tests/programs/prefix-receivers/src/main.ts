export interface Face { a: number; b: string }

// Reaches `Face` and begins with its fields: a prefix receiver.
class Prefix { a = 1; b = "p"; c = 2; }
// Reaches `Face` through its base's fields, and begins with them too.
class Base { a = 6; b = "base"; }
class Derived extends Base { e = 7; }
// Reaches `Face` with its fields behind its base's, where layout cannot move
// them -- a class's own fields can be reordered: read through a row.
class Leading { z = 0; }
class Shifted extends Leading { a = 3; b = "s"; }
// Begins with `Face`'s fields but never reaches it.
class Unrelated { a = 4; b = "u"; d = 5; }

function read(face: Face): string { return face.b + face.a; }

// Allocated at and never read through, as `tests/programs/readonly`'s `Config`:
// storage with no family and no receivers.
export interface Settings { a: number; b: string }
export const settings: Settings = { a: 1, b: "s" };

// An instantiation is its own type: `Box<number>` answers for itself.
interface Box<T> { value: T; tag: string }
class NumberBox { value = 1; tag = "n"; extra = 2; }
function unbox(box: Box<number>): number { return box.value; }

export function main(n: number): string {
  const unrelated = new Unrelated();
  return read(new Prefix()) + read(new Derived()) + read(new Shifted()) + unrelated.b + unbox(new NumberBox()) + n;
}
