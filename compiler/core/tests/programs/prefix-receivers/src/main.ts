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

// Reaching a face only as `this`: a method registers its own receiver, which
// TypeScript types as the class's polymorphic `this`, not as the class. A
// subclass inheriting the method reaches it the same way. `Outside` differs in
// one thing, being pushed from outside, and was always listed. Each has a
// field past the face's, as `Prefix` does, so no layout coincides with it --
// and `Outside`'s is named apart from `SelfRegistering`'s, since two classes
// of one shape share a layout and a face lists one owner per layout.
interface Registered { a: number; b: number }
class OtherOrder { b = 3; a = 4; }
const registry: Registered[] = [];
class SelfRegistering { a = 1; b = 2; tag = "self"; reg(): void { registry.push(this); } }
class SubRegistering extends SelfRegistering { c = 5; }
class Outside { a = 6; b = 7; label = "outside"; }
function readRegistered(registered: Registered): number { return registered.a; }

export function main(n: number): string {
  const unrelated = new Unrelated();
  readRegistered(new OtherOrder());
  new SelfRegistering().reg();
  new SubRegistering().reg();
  registry.push(new Outside());
  const last = readRegistered(registry[registry.length - 1]);
  return read(new Prefix()) + read(new Derived()) + read(new Shifted()) + unrelated.b + unbox(new NumberBox()) + last + n;
}
