// GTK through the `gi:` surface: GIR's names, camelCase members, and every
// other namespace's types qualified -- the same binding as `c:Gtk-4.0`,
// spelled for a TypeScript program (tooling/cli/src/bind_gir/naming.rs).
//
// The log, in order:
//
//   made hi! 6 true 1  `new Box({ orientation, spacing })` and
//                 `new Label({ label, useMarkup })`: camelCase props through
//                 the setters GIR names; `box.append`, `label.getLabel()`,
//                 the `label` property written and read, `box.getOrientation()`
//                 (1 is `Orientation.VERTICAL`)
//   wider 10      an override, `vfuncMeasure`, written in plain TypeScript
//                 types, chaining up with `super.vfuncMeasure` and answering
//                 the parent's natural width plus ten
//   order=12      `connect` and `connectAfter`, run by `emit` in that order
//   items=1       `new Gio.ListStore({ itemType })` through a namespace import:
//                 a construct-only property under its camelCase key
//   priority=0 string=64  GIR's constants by GIR's names, `PRIORITY_DEFAULT`
//                 and `TYPE_STRING`, folded where they are read
//   book Solaris 413 true me title 978  a class over `GObject` whose
//                 properties are declared `title = property("")`, and which
//                 names itself in its heritage clause, `extends
//                 GObject<Book>`, so it is constructed by them with no
//                 constructor written: typed from
//                 their defaults, given by props, written (`+=` included) and
//                 read, `notify::title` fired by a write; `readonly isbn =
//                 property<string>()`, which has no default, given by the
//                 construction -- one that leaves it out does not typecheck
//   tally count 2 3  a signal declared `readonly incremented =
//                 signal<[by: number]>()`, and emitted and connected by its
//                 name, as a binding's own are, its argument typed by the
//                 declaration: two clicks emit 1 and 2
import { Box, Button, Label, Orientation, init } from "gi:gtk";
import * as Gio from "gi:gio";
import { PRIORITY_DEFAULT } from "gi:glib";
import { GObject, TYPE_STRING, property, signal } from "gi:gobject";
import type { CNumber } from "c:types";

class Wider extends Label {
  // The binding's own types: GTK's sizes are C `int`s, and ten more than the
  // largest one stays the largest.
  vfuncMeasure(orientation: Orientation, forSize: CNumber<"int">): [CNumber<"int">, CNumber<"int">, CNumber<"int">, CNumber<"int">] {
    const [minimum, natural, minimumBaseline, naturalBaseline] = super.vfuncMeasure(orientation, forSize);
    return [Math.min(minimum + 10, 2147483647), Math.min(natural + 10, 2147483647), minimumBaseline, naturalBaseline];
  }
}

class Book extends GObject<Book> {
  title = property("");
  pageCount = property(0);
  done = property(false);
  owner = property<Label | null>(null);
  readonly isbn = property<string>();
}

class Tally extends Button<Tally> {
  readonly incremented = signal<[by: number]>();
  count = 0;
  vfuncClicked(): void {
    this.count++;
    this.emit("incremented", this.count);
  }
}

function tallied(): string {
  const tally = new Tally({ label: "count" });
  let seen = 0;
  tally.connect("incremented", (_self, by) => {
    seen += by;
  });
  tally.emit("clicked");
  tally.emit("clicked");
  return `tally ${tally.label} ${tally.count} ${seen}`;
}

function books(): string {
  const book = new Book({ title: "Dune", pageCount: 412, isbn: "978" });
  let notified = "";
  book.connect("notify::title", () => {
    notified += "title";
  });
  book.title = "Solaris";
  book.pageCount += 1;
  book.done = true;
  book.owner = new Label({ label: "me" });
  const owner = book.owner === null ? "none" : book.owner.label;
  return `book ${book.title} ${book.pageCount} ${book.done} ${owner} ${notified} ${book.isbn}`;
}

function main(): void {
  const box = new Box({ orientation: Orientation.VERTICAL, spacing: 6 });
  const label = new Label({ label: "hi", useMarkup: true });
  box.append(label);
  label.label = label.getLabel() + "!";
  console.log("made " + label.label + " " + String(box.spacing) + " " + String(label.useMarkup) + " " + String(box.getOrientation()));

  const [, plainNatural] = new Label({ label: "same" }).measure(Orientation.HORIZONTAL, -1);
  const [, widerNatural] = new Wider({ label: "same" }).measure(Orientation.HORIZONTAL, -1);
  console.log("wider " + String(widerNatural - plainNatural));

  const button = new Button({ label: "b" });
  let order = "";
  button.connectAfter("clicked", () => {
    order += "2";
  });
  button.connect("clicked", () => {
    order += "1";
  });
  button.emit("clicked");
  console.log("order=" + order);

  const store = new Gio.ListStore({ itemType: Label.$gtype });
  store.append(label);
  console.log("items=" + String(store.getNItems()));
  console.log("priority=" + String(PRIORITY_DEFAULT) + " string=" + String(TYPE_STRING));
  console.log(books());
  console.log(tallied());
}

init();
main();
