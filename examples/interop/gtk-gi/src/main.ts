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
import { Box, Button, Label, Orientation, init } from "gi:gtk";
import * as Gio from "gi:gio";
import { PRIORITY_DEFAULT } from "gi:glib";
import { TYPE_STRING } from "gi:gobject";

class Wider extends Label {
  vfuncMeasure(orientation: Orientation, forSize: number): [number, number, number, number] {
    const [minimum, natural, minimumBaseline, naturalBaseline] = super.vfuncMeasure(orientation, forSize);
    return [minimum + 10, natural + 10, minimumBaseline, naturalBaseline];
  }
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
}

init();
main();
