// Classes written over GObject classes, as GJS writes them: each is a GType of
// its own, and a `vfunc_` method is the override GTK calls through the class
// struct -- not a method nothing reaches.
//
// What it checks, logged for build.sh:
//
//   clicked 0! / clicked 0!!  `Counter`'s `vfunc_clicked`, run by GTK's own
//                 `clicked` signal: `this` is the button, and it calls one of
//                 its class's own methods (`suffix`)
//   type Nts_Counter  the instance is of the class's own GType
//   plain p       a `GtkButton` made beside it keeps GTK's `clicked`: the
//                 override is the subclass's, not the parent's
//   measure 42 17  `Square`, over the *abstract* `GtkWidget`, answers
//                 `gtk_widget_measure` through its `vfunc_measure`, which
//                 writes through the out parameters GTK passes
//   square Nts_Square
import {
  GtkButton,
  GtkWidget,
  gtk_init,
  gtk_widget_measure,
  Orientation,
  type GtkOrientation,
} from "c:Gtk-4.0";
import { g_type_name_from_instance } from "c:GObject-2.0";
import type { CEnum, CNumber, Ptr, c_uint } from "c:types";
import { local } from "c:memory";
import { sub_emit, sub_log } from "c:sub";

class Counter extends GtkButton {
  suffix(): string {
    return "!";
  }

  vfunc_clicked(): void {
    this.set_label((this.label ?? "") + this.suffix());
    sub_log("clicked " + (this.label ?? ""));
  }
}

class Square extends GtkWidget {
  vfunc_measure(
    orientation: CEnum<GtkOrientation, c_uint>,
    for_size: CNumber<"int">,
    minimum: Ptr<CNumber<"int">> | null,
    natural: Ptr<CNumber<"int">> | null,
    minimum_baseline: Ptr<CNumber<"int">> | null,
    natural_baseline: Ptr<CNumber<"int">> | null,
  ): void {
    const size = orientation === Orientation.HORIZONTAL ? 42 : 17;
    if (minimum !== null) minimum[0] = size;
    if (natural !== null) natural[0] = size;
    if (minimum_baseline !== null) minimum_baseline[0] = -1;
    if (natural_baseline !== null) natural_baseline[0] = -1;
    void for_size;
  }
}

function main(): void {
  gtk_init();
  const counter = new Counter({ label: "0" });
  sub_emit(counter, "clicked");
  sub_emit(counter, "clicked");
  sub_log("type " + g_type_name_from_instance(counter));
  const plain = new GtkButton({ label: "p" });
  sub_emit(plain, "clicked");
  sub_log("plain " + (plain.label ?? ""));

  const square = new Square({});
  const width = local<CNumber<"int">>();
  const height = local<CNumber<"int">>();
  gtk_widget_measure(square, Orientation.HORIZONTAL, -1, width);
  gtk_widget_measure(square, Orientation.VERTICAL, -1, height);
  sub_log("measure " + String(width[0]) + " " + String(height[0]));
  sub_log("square " + g_type_name_from_instance(square));
}

main();
