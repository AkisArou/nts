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
//   count 2 seen 0|0!  its fields, which the override wrote, read from
//                 outside the class: they live in an object the instance holds
//   plain p       a `GtkButton` made beside it keeps GTK's `clicked`: the
//                 override is the subclass's, not the parent's
//   hello ada from hi ada  `Greeter`'s constructor: `super({ label })` made
//                 it, the body set a field and connected a handler that reads
//                 it through `this`
//   greeter Nts_Greeter
//   framed in false fr unset Nts_Framed  `Framed`'s constructor passes the
//                 caller's props object through (`super(props)`): the child
//                 label, a handle held erased in an optional field, `sensitive`
//                 false and `name` are set; `label`, not given, is not
//   tally +2=2+3=5 on kid  signals `Tally` declares (`extends GtkButton<{
//                 ... }>`): `incremented` emitted by a method, with the
//                 number it carries and the handler reading the instance's
//                 field; `renamed` with two strings, `toggled` with a
//                 boolean, `adopted` with a GObject.
//                 Registered on `Tally`'s own `GType`, so nothing is emitted
//                 by name: a class that declared none reads `tally` alone
//   notes title done weight title a b true 2.5  properties `Note`
//                 declares (`Property<T>`): each write of one notifies with
//                 its name -- `plain`, a field only, does not -- and
//                 `bind_property` reads `title` through `get_property`, then
//                 writes `b` back through `set_property`, which notifies too
//   panel from the template true  `Panel` is built from a template (`static
//                 readonly template`): the label its template makes is the
//                 widget's first child, and the `declare`d field `title` reads
//                 it by its id (`gtk_widget_get_template_child`). Without the
//                 template's registration the field read NULL, a critical
//   pressed 1 p   the template's button, clicked: its `<signal handler>` is
//                 the class's `onPressed`, called with the button and `this`
//   measure 42 17  `Square`, over the *abstract* `GtkWidget`, answers
//                 `gtk_widget_measure` through its `vfunc_measure`, which
//                 writes through the out parameters GTK passes
//   square Nts_Square
//   shy 1 true  `Shy`'s `vfunc_show` counts and chains up
//                 (`super.vfunc_show()`) to GTK's, which is what makes the
//                 widget visible: an override that skipped it reads `shy 1 false`
//   A 2 B 11 2 C 101 11 2 ... Nts_C 3 12 102  three classes the program
//                 wrote, each over the last: every `vfunc_clicked` chains up
//                 to its parent's, each reads its own fields and its parents'
//                 (`A`'s through `A`'s own method), and all three are read
//                 from outside -- one state object, `A`'s fields first
//   Q 6           the parent has the fields and the child none
//   R S 8         the parent has none and the child has them
//   is C|B|label|button|none  `instanceof`, which asks the type system
//                 (`g_type_check_instance_is_a`) for a class the program wrote
//                 and for a binding's, and narrows: `C`'s field read after it
import {
  GtkBox,
  GtkButton,
  GtkLabel,
  GtkWidget,
  type GtkButtonProps,
  gtk_init,
  gtk_label_get_type,
  gtk_widget_measure,
  Orientation,
  type GtkOrientation,
} from "c:Gtk-4.0";
import { BindingFlags, GObject, g_object_bind_property, g_type_name_from_instance } from "c:GObject-2.0";
import { type GListModel, type GListModelImplementation, g_list_model_get_n_items, g_list_model_get_object } from "c:Gio-2.0";
import type { CEnum, CNumber, Erased, Owned, Property, Ptr, c_size_t, c_uint } from "c:types";
import { local } from "c:memory";
import { sub_emit, sub_log } from "c:sub";

class Counter extends GtkButton {
  // Fields: an object of the program's own that the instance holds, made by
  // `instance_init` and given back by `finalize`.
  count = 0;
  readonly seen: string[] = [];

  suffix(): string {
    return "!";
  }

  vfunc_clicked(): void {
    this.count++;
    this.seen.push(this.label ?? "");
    this.set_label((this.label ?? "") + this.suffix());
    sub_log("clicked " + (this.label ?? ""));
  }
}

class Greeter extends GtkButton {
  greeting = "";

  // GJS's constructor: `super(...)` makes the instance -- this class's own
  // GType, the literal's properties set -- and the body runs with `this`.
  constructor(name: string) {
    super({ label: "hi " + name });
    this.greeting = "hello " + name;
    this.connect("clicked", () => {
      sub_log(this.greeting + " from " + (this.label ?? ""));
    });
  }
}

// GJS's other constructor: the caller's props object passed straight through,
// `super(props)`. Each property the type declares is read from it and set only
// where it was given.
class Framed extends GtkButton {
  constructor(props: GtkButtonProps) {
    super(props);
  }
}

function framed(): string {
  const inner = new GtkLabel({ label: "in" });
  const f = new Framed({ child: inner, sensitive: false, name: "fr" });
  const child = f.child;
  return [
    "framed",
    child instanceof GtkLabel ? (child.label ?? "") : "none",
    String(f.sensitive),
    f.name ?? "",
    f.label ?? "unset",
    g_type_name_from_instance(f),
  ].join(" ");
}

// Signals a class declares, GJS's `Signals`: `incremented` carries a number,
// `renamed` two strings, `toggled` a boolean and `adopted` a handle.
class Tally extends GtkButton<{
  incremented: [by: number];
  renamed: [to: string, from: string];
  toggled: [on: boolean];
  adopted: [child: GtkLabel];
}> {
  total = 0;

  bump(by: number): void {
    this.total += by;
    this.emit("incremented", by);
  }
}

function tally(): string {
  const t = new Tally({ label: "t" });
  let seen = "";
  t.connect("incremented", (self, by) => {
    seen += "+" + String(by) + "=" + String(self.total);
  });
  t.connect("renamed", (_self, to, from) => {
    seen += " " + from + ">" + to;
  });
  t.connect("toggled", (_self, on) => {
    seen += on ? " on" : " off";
  });
  t.connect("adopted", (_self, child) => {
    seen += " " + (child.label ?? "");
  });
  t.bump(2);
  t.bump(3);
  t.emit("renamed", "b", "a");
  t.emit("toggled", true);
  t.emit("adopted", new GtkLabel({ label: "kid" }));
  return "tally " + seen.trim();
}

// Properties a class declares, GJS's `Properties`: `title`, `done` and
// `weight` are fields the class reads and writes as any other, and GObject
// properties too; `plain` is a field and nothing more.
class Note extends GObject {
  title: Property<string> = "";
  done: Property<boolean> = false;
  weight: Property<number> = 0;
  plain = 1;
}

function notes(): string {
  const note = new Note({});
  let seen = "";
  note.connect("notify", (_self, pspec) => {
    seen += " " + pspec.get_name();
  });
  note.title = "a";
  note.done = true;
  note.weight = 2.5;
  note.plain = 2;
  // Read through `get_property` (`SYNC_CREATE` copies the title across),
  // then written back through `set_property` (`BIDIRECTIONAL`).
  const label = new GtkLabel({ label: "" });
  g_object_bind_property(note, "title", label, "label", BindingFlags.SYNC_CREATE | BindingFlags.BIDIRECTIONAL);
  const synced = label.label ?? "";
  label.set_label("b");
  return "notes" + seen + " " + synced + " " + note.title + " " + String(note.done) + " " + String(note.weight);
}

// A class built from a template, GJS's `Template` and `InternalChildren`: the
// template makes the children, and a `declare`d field names one by its id.
class Panel extends GtkBox {
  static readonly template = `<interface>
  <template class="Nts_Panel" parent="GtkBox">
    <child>
      <object class="GtkLabel" id="title">
        <property name="label">from the template</property>
      </object>
    </child>
    <child>
      <object class="GtkButton" id="press">
        <property name="label">p</property>
        <signal name="clicked" handler="onPressed"/>
      </object>
    </child>
  </template>
</interface>`;
  declare readonly title: GtkLabel;
  declare readonly press: GtkButton;
  pressed = 0;

  // A handler the template names: GTK calls it with the button, and `this`
  // is the panel.
  onPressed(button: GtkButton): void {
    this.pressed++;
    this.title.set_label(button.label ?? "");
  }
}

function panel(): string {
  const made = new Panel({});
  const first = made.get_first_child();
  const before = "panel " + (made.title.label ?? "") + " " + String(first === made.title);
  sub_emit(made.press, "clicked");
  return before + " pressed " + String(made.pressed) + " " + (made.title.label ?? "");
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

class Shy extends GtkButton {
  shown = 0;

  // Chaining up: GTK's own `show` is what marks the widget visible, so an
  // override that did not reach it would leave it hidden.
  vfunc_show(): void {
    this.shown++;
    super.vfunc_show();
  }
}

// Classes over classes the program wrote. One object holds each chain's
// fields, in the slot of its first class that has any, and each class's state
// begins with its parent's (`verify` checks that prefix).
class A extends GtkButton {
  a = 1;
  bumpA(): number {
    this.a++;
    return this.a;
  }
  vfunc_clicked(): void {
    sub_log("A " + String(this.bumpA()));
  }
}

class B extends A {
  b = 10;
  vfunc_clicked(): void {
    this.b++;
    super.vfunc_clicked();
    sub_log("B " + String(this.b) + " " + String(this.a));
  }
}

class C extends B {
  c = 100;
  vfunc_clicked(): void {
    this.c++;
    super.vfunc_clicked();
    sub_log("C " + String(this.c) + " " + String(this.b) + " " + String(this.a));
  }
}

class P extends GtkButton {
  p = 5;
}

class Q extends P {
  vfunc_clicked(): void {
    this.p++;
    sub_log("Q " + String(this.p));
  }
}

class R extends GtkButton {
  vfunc_clicked(): void {
    sub_log("R");
  }
}

class S extends R {
  s = 7;
  vfunc_clicked(): void {
    this.s++;
    super.vfunc_clicked();
    sub_log("S " + String(this.s));
  }
}

function chains(): void {
  const c = new C({ label: "c" });
  sub_emit(c, "clicked");
  sub_emit(c, "clicked");
  sub_log(g_type_name_from_instance(c) + " " + String(c.a) + " " + String(c.b) + " " + String(c.c));
  const q = new Q({ label: "q" });
  sub_emit(q, "clicked");
  const s = new S({ label: "s" });
  sub_emit(s, "clicked");
}

function kind(widget: GtkWidget | null): string {
  if (widget instanceof C) return "C" + String(widget.c);
  if (widget instanceof B) return "B";
  if (widget instanceof GtkLabel) return "label";
  if (widget instanceof GtkButton) return "button";
  return "none";
}

// A class implementing a GObject interface (`GListModelImplementation`): its
// `vfunc_` methods fill `GListModelInterface`, not the class struct, and the
// instance converts to a `GListModel`, which Gio's own functions call through.
class Words extends GObject<{}, GListModelImplementation> {
  readonly words: string[] = ["alpha", "beta", "gamma"];
  vfunc_get_n_items(): CNumber<"uint"> {
    return this.words.length;
  }
  vfunc_get_item_type(): c_size_t {
    return gtk_label_get_type();
  }
  vfunc_get_item(position: CNumber<"uint">): Owned<Erased<GObject>> | null {
    return position < this.words.length ? new GtkLabel({ label: this.words[position] }) : null;
  }
}

function words(): string {
  const model: GListModel = new Words();
  const second = g_list_model_get_object(model, 1);
  const label = second instanceof GtkLabel ? second.label : "?";
  return "words " + String(g_list_model_get_n_items(model)) + " " + label + " " + String(g_list_model_get_object(model, 3) === null);
}

function main(): void {
  gtk_init();
  const counter = new Counter({ label: "0" });
  sub_emit(counter, "clicked");
  sub_emit(counter, "clicked");
  sub_log("type " + g_type_name_from_instance(counter));
  sub_log("count " + String(counter.count) + " seen " + counter.seen.join("|"));
  const plain = new GtkButton({ label: "p" });
  sub_emit(plain, "clicked");
  sub_log("plain " + (plain.label ?? ""));

  const greeter = new Greeter("ada");
  sub_emit(greeter, "clicked");
  sub_log("greeter " + g_type_name_from_instance(greeter));
  sub_log(framed());
  sub_log(tally());
  sub_log(notes());
  sub_log(panel());

  const square = new Square({});
  const width = local<CNumber<"int">>();
  const height = local<CNumber<"int">>();
  gtk_widget_measure(square, Orientation.HORIZONTAL, -1, width);
  gtk_widget_measure(square, Orientation.VERTICAL, -1, height);
  sub_log("measure " + String(width[0]) + " " + String(height[0]));
  sub_log("square " + g_type_name_from_instance(square));

  const shy = new Shy({ label: "s" });
  shy.set_visible(false);
  shy.set_visible(true);
  sub_log("shy " + String(shy.shown) + " " + String(shy.get_visible()));
  chains();
  sub_log(words());
  sub_log("is " + [kind(new C({})), kind(new B({})), kind(new GtkLabel({})), kind(new GtkButton({})), kind(null)].join("|"));
}

main();
