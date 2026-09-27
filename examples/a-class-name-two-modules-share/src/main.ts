// Two modules each exporting a class named `Box`. Every name a class member is
// emitted under is built in more than one place, and they have to agree letter
// for letter: the class's own hierarchy entry names the *definition* of an
// instance method, `class_name` names what a *call site* writes, and a static
// goes through a third path. Before this example, the first read the
// identifier's text and the others read the disambiguating map, so both `Box`es
// spelled their method `Box#area`.
//
// The consequence was not a duplicate symbol. **No vtable was emitted at all**,
// the descriptors carried a null method table, and `total`'s virtual call went
// through it: `exit 139`, with no refusal and nothing in the output to read. The
// React lane found it because libadwaita's generated `HeaderBarNode` shares a
// name with GTK's.
//
// The same two modules also export a function `origin`, which has always been
// qualified -- it is the arm that says the mechanism existed and only classes
// were left out of half of it.
//
// `Circle` is the control: a name nothing else uses, whose emitted name stays
// unqualified. If qualifying became unconditional, every program's symbols would
// move and this arm would not notice -- but `emit-c` over the corpus does, and
// it is byte-identical outside these two modules.
import { Shape } from "./shape.ts";
import { Circle } from "./shape.ts";
import { Box as Flat, Tag as FlatTag, origin as flatOrigin } from "./flat.ts";
import { Box as Deep, Tag as DeepTag, origin as deepOrigin } from "./deep.ts";

function total(shapes: Shape[]): number {
  let sum = 0;
  for (const shape of shapes) {
    sum += shape.area();
  }
  return sum;
}

/**
 * Virtual dispatch over both, which is the shape that segfaulted: one method
 * table for two classes, and the table was null.
 */
export function throughTheBase(n: number): number {
  return total([new Flat(n), new Deep(n, 3), new Circle(2)]);
}

/** The same two called directly, where the callee is named at the call site. */
export function directly(n: number): number {
  return new Flat(n).area() * 1000 + new Deep(n, 4).area();
}

/**
 * A field read on each. The two layouts differ, so a shared struct would read
 * `width` out of the slot the other keeps `side` in.
 */
export function fields(n: number): number {
  const flat = new Flat(n);
  const deep = new Deep(n, 5);
  return flat.side * 1000 + deep.width * 10 + deep.height;
}

/** A static of one name on each -- a third naming path, and it collided too. */
export function statics(n: number): number {
  return Flat.made() + Deep.made() + n;
}

/** A getter of one name on each: the accessor path is a fourth. */
export function accessors(n: number): number {
  const flat: Shape = new Flat(n);
  const deep: Shape = new Deep(n, 1);
  return new Flat(n).label * 10 + new Deep(n, 1).label + total([flat, deep]);
}

/** `instanceof` tells them apart, which needs a descriptor each. */
export function which(n: number): number {
  const shapes: Shape[] = [new Flat(n), new Deep(n, 2)];
  let score = 0;
  for (const shape of shapes) {
    score = score * 10 + (shape instanceof Flat ? 1 : 2);
  }
  return score;
}

/** **Control.** Two functions of one name, which have always been qualified. */
export function functionsOfOneName(n: number): number {
  return flatOrigin() * 100 + deepOrigin() + n;
}

/**
 * The silent half: two fieldless classes of one name, dispatched virtually.
 * Identical shapes share a struct by design and the descriptors keep them apart,
 * so nothing here is refused -- before the fix this answered by calling through a
 * null method table.
 */
export function sharedShape(n: number): number {
  const tags: Shape[] = [new FlatTag(), new DeepTag()];
  return total(tags) * 10 + n;
}
