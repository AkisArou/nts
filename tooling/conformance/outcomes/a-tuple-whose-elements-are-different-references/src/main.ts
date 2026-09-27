// **A tuple whose elements are all references, of different types, is
// represented as an array of the *first* element's type** (`tuple_representation`,
// `lower.rs`), and a destructuring read then types every position at that one
// type. The compiler lane expected that to compile and answer wrong. Measured on
// a clean 7f574cf87, it does neither: every such tuple is refused where it is
// *built*, and each destructuring read is refused too.
//
//   [string[], number[]]  "an array of Float where an array of Managed(String) is
//                          wanted -- the two hold different widths"
//   [Box, Label]          "a `Label` where a `Box` is wanted"; the read: "`size`,
//                          which `Box` does not declare"
//   [Map, Counts]         "a `Counts` where a table is wanted"; the read: "`a`,
//                          where a `Map` or a `Set` has only `size`" (the arm a
//                          peer reported)
//
// The by-index spelling (`pair[1]`) is refused with them, because it calls the
// same builder. So a wrong answer needs a tuple nts does not build, like
// GTK's `gtk_cell_area_get_cell_at_position` (`[GtkCellRenderer, GdkRectangle]`),
// filled natively. node cannot run that, so it is not an arm here.
//
// **A guard, recorded before the reader changes.** Each refused arm's top-level
// call is cut, so `ran` shows the arms that still run: the boundaries, which
// must keep agreeing. `[number, number]` is homogeneous. `[string, number]` is
// mixed storage and takes the object arm. `[Box, number]` has one scalar
// element, which fails the all-references test, so it is safe -- the
// opposite of what intuition offers. A change that makes the three shapes
// compile moves the record: CHANGED if they answer wrong, and a person
// re-records it if they agree.

class Box {
  constructor(readonly width: number, readonly height: number) {}
}

class Label {
  constructor(readonly text: string, readonly size: number) {}
}

interface Counts {
  a: number;
  b: number;
}

const words: string[] = ["ab", "cde"];
const lengths: number[] = [7, 8, 9];
const box = new Box(6, 9);
const label = new Label("hi", 12);
const table = new Map<string, number>([["x", 1]]);
const counts: Counts = { a: 2, b: 3 };

function arrays(): [string[], number[]] {
  return [words, lengths];
}

function classes(): [Box, Label] {
  return [box, label];
}

function mapAndObject(): [Map<string, number>, Counts] {
  return [table, counts];
}

function arraysDestructured(): string {
  const [w, n] = arrays();
  return `${w.length}/${n.length}/${n[0] + n[2]}`;
}

function arraysByIndex(): string {
  const pair = arrays();
  return `${pair[0].length}/${pair[1].length}/${pair[1][0] + pair[1][2]}`;
}

function classesDestructured(): string {
  const [b, l] = classes();
  return `${b.width}/${l.size}/${l.text}`;
}

function classesByIndex(): string {
  const pair = classes();
  return `${pair[0].width}/${pair[1].size}/${pair[1].text}`;
}

function mapDestructured(): string {
  const [m, c] = mapAndObject();
  return `${m.get("x") ?? 0}/${c.a}/${c.b}`;
}

function mapByIndex(): string {
  const pair = mapAndObject();
  return `${pair[0].get("x") ?? 0}/${pair[1].a}/${pair[1].b}`;
}

function numbers(): string {
  const make = (): [number, number] => [3, 4];
  const [x, y] = make();
  return String(x * 10 + y);
}

function stringAndNumber(): string {
  const make = (): [string, number] => ["k", 5];
  const [k, v] = make();
  return `${k}${v + 1}`;
}

function referenceAndNumber(): string {
  const make = (): [Box, number] => [new Box(6, 9), 7];
  const [b, count] = make();
  return String(b.width * 10 + count);
}

observe("[string[], number[]] destructured", arraysDestructured());
observe("[string[], number[]] by index", arraysByIndex());
observe("[Box, Label] destructured", classesDestructured());
observe("[Box, Label] by index", classesByIndex());
observe("[Map, Counts] destructured", mapDestructured());
observe("[Map, Counts] by index", mapByIndex());
observe("[number, number]", numbers());
observe("[string, number]", stringAndNumber());
observe("[Box, number]", referenceAndNumber());
done();
