// Workbench's "Box" demo (CC0, workbenchdev/demos), ported.
//
// GJS reads each builder object untyped; here one typed getter per kind
// narrows it, in place of fifteen `instanceof` tests.
import { Align, GtkBox, GtkButton, GtkCheckButton, GtkLabel, GtkToggleButton, Orientation } from "c:Gtk-4.0";
import { run, type Workbench } from "../../host/workbench.ts";

function demo(workbench: Workbench): void {
  const object = (id: string) => workbench.builder.get_object(id);
  const toggle = (id: string): GtkToggleButton => {
    const found = object(id);
    if (!(found instanceof GtkToggleButton)) throw new Error(`the demo's UI: ${id}`);
    return found;
  };
  const button = (id: string): GtkButton => {
    const found = object(id);
    if (!(found instanceof GtkButton)) throw new Error(`the demo's UI: ${id}`);
    return found;
  };
  // Typed where it is fetched: the functions below are declarations, which
  // TypeScript hoists above any narrowing, and GJS passes them before they
  // are written.
  const box = (id: string): GtkBox => {
    const found = object(id);
    if (!(found instanceof GtkBox)) throw new Error(`the demo's UI: ${id}`);
    return found;
  };
  const interactive_box = box("interactive_box");
  const highlight = object("highlight");
  if (!(highlight instanceof GtkCheckButton)) throw new Error("the demo's UI");

  const button_append = button("button_append");
  const button_prepend = button("button_prepend");
  const button_remove = button("button_remove");
  let count = 0;

  button_append.connect("clicked", append);
  button_prepend.connect("clicked", prepend);
  button_remove.connect("clicked", remove);

  const toggle_orientation_horizontal = toggle("toggle_orientation_horizontal");
  const toggle_orientation_vertical = toggle("toggle_orientation_vertical");

  toggle_orientation_horizontal.connect("toggled", () => {
    if (toggle_orientation_horizontal.active) interactive_box.orientation = Orientation.HORIZONTAL;
  });

  toggle_orientation_vertical.connect("toggled", () => {
    if (toggle_orientation_vertical.active) interactive_box.orientation = Orientation.VERTICAL;
  });

  highlight.connect("toggled", () => {
    highlight.active ? interactive_box.add_css_class("border") : interactive_box.remove_css_class("border");
  });

  const halign_toggle_fill = toggle("halign_toggle_fill");
  const halign_toggle_start = toggle("halign_toggle_start");
  const halign_toggle_center = toggle("halign_toggle_center");
  const halign_toggle_end = toggle("halign_toggle_end");

  halign_toggle_fill.connect("toggled", () => {
    if (halign_toggle_fill.active) interactive_box.halign = Align.FILL;
  });

  halign_toggle_start.connect("toggled", () => {
    if (halign_toggle_start.active) interactive_box.halign = Align.START;
  });

  halign_toggle_center.connect("toggled", () => {
    if (halign_toggle_center.active) interactive_box.halign = Align.CENTER;
  });

  halign_toggle_end.connect("toggled", () => {
    if (halign_toggle_end.active) interactive_box.halign = Align.END;
  });

  const valign_toggle_fill = toggle("valign_toggle_fill");
  const valign_toggle_start = toggle("valign_toggle_start");
  const valign_toggle_center = toggle("valign_toggle_center");
  const valign_toggle_end = toggle("valign_toggle_end");

  valign_toggle_fill.connect("toggled", () => {
    if (valign_toggle_fill.active) interactive_box.valign = Align.FILL;
  });

  valign_toggle_start.connect("toggled", () => {
    if (valign_toggle_start.active) interactive_box.valign = Align.START;
  });

  valign_toggle_center.connect("toggled", () => {
    if (valign_toggle_center.active) interactive_box.valign = Align.CENTER;
  });
  valign_toggle_end.connect("toggled", () => {
    if (valign_toggle_end.active) interactive_box.valign = Align.END;
  });

  function append(): void {
    const label = new GtkLabel({
      name: "card",
      label: `Item ${count + 1}`,
      css_classes: ["card"],
    });
    interactive_box.append(label);
    count++;
  }

  function prepend(): void {
    const label = new GtkLabel({
      name: "card",
      label: `Item ${count + 1}`,
      css_classes: ["card"],
    });
    interactive_box.prepend(label);
    count++;
  }

  function remove(): void {
    const last = interactive_box.get_last_child();
    if (count && last !== null) {
      interactive_box.remove(last);
      count--;
    } else {
      console.log("The box has no child widget to remove");
    }
  }

  append();
}

run(demo);
