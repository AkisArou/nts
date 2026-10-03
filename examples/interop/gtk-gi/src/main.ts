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
//   book Solaris 413 true me title 978 []  a class over `GObject` whose
//                 properties are declared `title = property("")`: typed from
//                 their defaults, given by props, written (`+=` included) and
//                 read, `notify::title` fired by a write; `readonly isbn =
//                 property<string>()` given by the construction, and its
//                 type's zero where none was given
import { Box, Button, Label, Orientation, init } from "gi:gtk";
import * as Gio from "gi:gio";
import { PRIORITY_DEFAULT } from "gi:glib";
import { GObject, type GObjectProps, TYPE_STRING, property } from "gi:gobject";
import type { Properties } from "c:types";

class Wider extends Label {
  vfuncMeasure(orientation: Orientation, forSize: number): [number, number, number, number] {
    const [minimum, natural, minimumBaseline, naturalBaseline] = super.vfuncMeasure(orientation, forSize);
    return [minimum + 10, natural + 10, minimumBaseline, naturalBaseline];
  }
}

class Book extends GObject {
  title = property("");
  pageCount = property(0);
  done = property(false);
  owner = property<Label | null>(null);
  readonly isbn = property<string>();
  constructor(props: Properties<Book, GObjectProps> = {}) {
    super(props);
  }
}

function books(): string {
  const book = new Book({ title: "Dune", pageCount: 412, isbn: "978" });
  const blank = new Book();
  let notified = "";
  book.connect("notify::title", () => {
    notified += "title";
  });
  book.title = "Solaris";
  book.pageCount += 1;
  book.done = true;
  book.owner = new Label({ label: "me" });
  const owner = book.owner === null ? "none" : book.owner.label;
  return `book ${book.title} ${book.pageCount} ${book.done} ${owner} ${notified} ${book.isbn} [${blank.isbn}]`;
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
}

init();
main();
