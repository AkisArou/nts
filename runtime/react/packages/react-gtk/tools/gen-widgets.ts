// Generates src/widgets.ts: a host node class for every GTK widget an app can
// construct, with its props and signals, from two inputs that must agree:
//
//   GIR (Gtk-4.0.gir and the namespaces it includes)   what a widget has: its
//       parent, interfaces, properties with their setters and defaults,
//       signals, methods
//   the bindings `nts build` generated from that GIR   what TypeScript can
//       call: a prop is set through its setter only if bind-gir declared it,
//       and its value is typed as that setter's parameter
//
// A prop is a writable, non-construct-only, non-deprecated GIR property with a
// setter, whose value a JSX attribute can carry: a string, a list of strings,
// a boolean, a number or an enum. Its name is the property's in camel case (`has-frame` →
// `hasFrame`). A signal prop is `on` + the signal's name in camel case
// (`clicked` → `onClicked`), its handler taking the signal's arguments after
// the widget, typed as an app writes them (`(row: GtkListBoxRow) => void`),
// when each is a widget, string, number, boolean or enum. A signal whose
// handler returns GTK's "handled" boolean takes a handler that returns one;
// with none, the widget's default runs. A prop with a getter also gets
// `onNotify<Prop>`, called with the property's new value. A widget-typed
// property either names another widget (a Label's mnemonic widget: a prop
// holding a ref's `current`) or places one (a Paned's start child: a slot
// element, `<Paned.StartChild>`, whose child it holds). What is left out is
// listed, with why, in src/widgets.skipped.txt.
//
// Each GIR class gets one function that sets its own props and hands any
// other key to its parent's, so Widget's props are written once, not once per
// widget.
//
// usage: node tools/gen-widgets.ts <bindings dir> [--check]
//   <bindings dir> holds Gtk-4.0.d.ts (a native program's types/gir);
//   GI_GIR_PATH overrides /usr/share/gir-1.0. --check compares instead of
//   writing, and fails if the committed files are stale.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const girDir = process.env.GI_GIR_PATH ?? "/usr/share/gir-1.0";

// ---- GIR ---------------------------------------------------------------------

interface XmlElement {
  name: string;
  attrs: Map<string, string>;
  children: XmlElement[];
}

/** The element tree of a GIR file: tags and attributes, no text. */
function parseXml(text: string): XmlElement {
  const root: XmlElement = { name: "#root", attrs: new Map(), children: [] };
  const stack = [root];
  const tag = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g;
  const attr = /([\w:.-]+)="([^"]*)"/g;
  for (const [, closing, name, attrText, selfClosing] of text.matchAll(tag)) {
    if (name === undefined) {
      continue; // a comment or the XML declaration
    }
    if (closing === "/") {
      stack.pop();
      continue;
    }
    const element: XmlElement = { name, attrs: new Map(), children: [] };
    for (const [, key, value] of (attrText ?? "").matchAll(attr)) {
      element.attrs.set(key!, unescapeXml(value!));
    }
    stack[stack.length - 1]!.children.push(element);
    if (selfClosing !== "/") {
      stack.push(element);
    }
  }
  return root;
}

function unescapeXml(text: string): string {
  const entities: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };
  return text.replace(/&(lt|gt|quot|apos|amp);/g, (_, name: string) => entities[name]!);
}

function child(element: XmlElement, name: string): XmlElement | undefined {
  return element.children.find((c) => c.name === name);
}

interface GirProperty {
  name: string;
  writable: boolean;
  constructOnly: boolean;
  deprecated: boolean;
  readable: boolean;
  setter: string | undefined;
  getter: string | undefined;
  defaultValue: string | undefined;
}

interface GirSignal {
  name: string;
  takesArguments: boolean;
  returnsValue: boolean;
  /** A parameter the handler fills (an Overlay's `get-child-position` allocation). */
  fillsArgument: string | undefined;
  deprecated: boolean;
}

interface GirType {
  name: string;
  /** The GIR namespace (`Gtk`, `Adw`), and its C prefix, which a TypeScript name carries: `GtkButton`. */
  namespace: string;
  prefix: string;
  kind: "class" | "interface";
  parent: string | undefined;
  abstract: boolean;
  deprecated: boolean;
  implements: string[];
  properties: GirProperty[];
  signals: GirSignal[];
  methods: Set<string>;
}

interface Gir {
  version: string;
  /** Every class and interface of the namespaces read, by qualified name: `Gtk.Widget`. */
  types: Map<string, GirType>;
  /** Every enum and flags member's value, by its C identifier, across namespaces. */
  members: Map<string, number>;
}

/** `Gtk.Widget` for Gtk's Widget: how GIR names a type from another namespace, and the key it is kept under. */
const qualified = (t: GirType): string => `${t.namespace}.${t.name}`;

/** Reads `namespaces` (`Gtk-4.0`, `Adw-1`) and what they include; the version is the last one's. */
function readGir(namespaces: string[]): Gir {
  const types = new Map<string, GirType>();
  const members = new Map<string, number>();
  const seen = new Set<string>();
  let version = "";
  const load = (file: string, primary: boolean): void => {
    const path = join(girDir, file);
    if (seen.has(file) || !existsSync(path)) {
      return;
    }
    seen.add(file);
    const repository = child(parseXml(readFileSync(path, "utf8")), "repository")!;
    for (const include of repository.children.filter((c) => c.name === "include")) {
      load(`${include.attrs.get("name")}-${include.attrs.get("version")}.gir`, false);
    }
    const namespace = child(repository, "namespace")!;
    const name = namespace.attrs.get("name")!;
    const prefix = namespace.attrs.get("c:identifier-prefixes") ?? name;
    for (const element of namespace.children) {
      if (element.name === "enumeration" || element.name === "bitfield") {
        for (const member of element.children.filter((c) => c.name === "member")) {
          members.set(member.attrs.get("c:identifier")!, Number(member.attrs.get("value")));
        }
      }
      if (primary && (element.name === "class" || element.name === "interface")) {
        const type = readType(element, name, prefix);
        types.set(qualified(type), type);
      }
    }
    if (primary) {
      version = namespace.attrs.get("version") ?? "";
    }
  };
  for (const file of namespaces) {
    load(`${file}.gir`, true);
  }
  return { version, types, members };
}

function readType(element: XmlElement, namespace: string, prefix: string): GirType {
  const flag = (e: XmlElement, name: string): boolean => e.attrs.get(name) === "1";
  const children = (name: string): XmlElement[] => element.children.filter((c) => c.name === name);
  // GIR names a type of its own namespace bare, and another's qualified.
  const qualify = (name: string): string => (name.includes(".") ? name : `${namespace}.${name}`);
  const parent = element.attrs.get("parent");
  return {
    name: element.attrs.get("name")!,
    namespace,
    prefix,
    kind: element.name === "class" ? "class" : "interface",
    parent: parent === undefined ? undefined : qualify(parent),
    abstract: flag(element, "abstract"),
    deprecated: flag(element, "deprecated"),
    implements: children("implements").map((c) => qualify(c.attrs.get("name")!)),
    properties: children("property").map((p) => ({
      name: p.attrs.get("name")!,
      writable: flag(p, "writable"),
      constructOnly: flag(p, "construct-only"),
      deprecated: flag(p, "deprecated"),
      readable: p.attrs.get("readable") !== "0",
      setter: p.attrs.get("setter"),
      getter: p.attrs.get("getter"),
      defaultValue: p.attrs.get("default-value"),
    })),
    signals: children("glib:signal").map((s) => ({
      name: s.attrs.get("name")!,
      takesArguments: child(s, "parameters") !== undefined,
      fillsArgument: (child(s, "parameters")?.children ?? []).find((p) => p.name === "parameter" && p.attrs.get("direction") === "out")?.attrs.get("name"),
      returnsValue: child(child(s, "return-value") ?? s, "type")?.attrs.get("name") !== "none",
      deprecated: flag(s, "deprecated"),
    })),
    methods: new Set(children("method").map((m) => m.attrs.get("name")!)),
  };
}

// ---- the bindings ------------------------------------------------------------

interface Bindings {
  /** Setters taking one value, by the TypeScript name of the type that declares them: `set_label` → `string`. */
  setters: Map<string, Map<string, string>>;
  /** Child methods taking one widget (`add`, `add_row`, `remove`), by type: the type they take. */
  childMethods: Map<string, Map<string, string>>;
  /**
   * Each property's accessors as the bindings name them (`@ntsGet`/`@ntsSet`),
   * by type and property (`width_request`): its own methods, or ones the
   * binder made for it (`$ntsPropSet_orientation`, where an inherited
   * `set_orientation` is another type's).
   */
  accessors: Map<string, Map<string, { get?: string; set?: string }>>;
  /** Getters taking nothing, the same way: `get_text` → `string`. */
  getters: Map<string, Map<string, string>>;
  /** Each signal's handler as bind-gir declared `connect` for it, by type and signal name. */
  signals: Map<string, Map<string, Signature>>;
  constructible: Set<string>;
  /**
   * Every class, in any of the bindings' namespaces, with a constructor
   * (abstract ones included): a value `instanceof` can check against.
   */
  classes: Set<string>;
  /** The module each type from another namespace comes from: `PangoWrapMode` → `c:Pango-1.0`. */
  modules: Map<string, string>;
  /** Boxed records, in any namespace: `GdkRGBA`, `PangoAttrList`, `GtkTreePath`. */
  boxed: Set<string>;
  /**
   * The types whose value has a constructor, classes and boxed records alike:
   * what `instanceof` takes as its right-hand side. A boxed value's GType is
   * recorded, so `instanceof` checks one as it does a class; a record whose
   * value holds only functions (`PangoAttrList.from_string`) is not checked.
   */
  newable: Set<string>;
  /**
   * For each GObject interface, the classes with a constructor that implement
   * it, topmost only (a subclass is an `instanceof` its parent): what a value
   * of that interface can be checked against. Empty for one only private
   * classes implement (`GFile`).
   */
  implementers: Map<string, string[]>;
}

/** A signal handler's parameters after the widget, and what it returns, as bind-gir typed them. */
interface Signature {
  params: { name: string; type: string }[];
  returns: string;
}

/** `text`'s items at depth zero, split at `separator`: `CEnum<A, B>, T` is two. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if ("<({[".includes(c)) depth++;
    else if (">)}]".includes(c) && text[i - 1] !== "=") depth--;
    else if (c === separator && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = text.slice(start).trim();
  return last === "" ? parts : [...parts, last];
}

/** The handler of a `connect(...)` line: `ErasedClosure<(self: T, a: A) => R, ...>`. */
function readSignature(line: string): Signature | null {
  const at = line.indexOf("handler: ErasedClosure<(");
  if (at < 0) return null;
  const open = at + "handler: ErasedClosure<".length;
  let depth = 0;
  let close = -1;
  for (let i = open; i < line.length; i++) {
    if (line[i] === "(") depth++;
    else if (line[i] === ")" && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close < 0 || !line.startsWith(" => ", close + 1)) return null;
  const returns = splitTopLevel(line.slice(close + 5), ",")[0]!;
  const params = splitTopLevel(line.slice(open + 1, close), ",").slice(1).map((param) => {
    const colon = param.indexOf(": ");
    return { name: param.slice(0, colon), type: param.slice(colon + 2) };
  });
  return { params, returns };
}

function readBindings(dir: string): Bindings {
  const setters = new Map<string, Map<string, string>>();
  const childMethods = new Map<string, Map<string, string>>();
  const accessors = new Map<string, Map<string, { get?: string; set?: string }>>();
  // The OwnMethods interface being read, and the tags of the doc comment
  // before the next property.
  let accessorsOf: Map<string, { get?: string; set?: string }> | null = null;
  let tagged: { get?: string; set?: string } = {};
  const getters = new Map<string, Map<string, string>>();
  const signals = new Map<string, Map<string, Signature>>();
  const constructible = new Set<string>();
  const modules = new Map<string, string>();
  const entry = <V>(map: Map<string, V>, key: string, make: () => V): V => {
    let value = map.get(key);
    if (value === undefined) {
      value = make();
      map.set(key, value);
    }
    return value;
  };
  const files = readdirSync(dir).filter((name) => name.endsWith(".d.ts"));
  for (const line of files.flatMap((file) => readFileSync(join(dir, file), "utf8").split("\n"))) {
    const imports = /^ {2}import type \{ (.+) \} from "(c:[\w.-]+)";$/.exec(line);
    if (imports !== null) {
      imports[1]!.split(", ").forEach((name) => modules.set(name, imports[2]!));
      continue;
    }
    const getter = /^ {4}(get_\w+|\$ntsPropGet_\w+)\(this: (\w+)\): (.+);$/.exec(line);
    if (getter !== null) {
      entry(getters, getter[2]!, () => new Map()).set(getter[1]!, getter[3]!);
      continue;
    }
    const ownMethods = /^ {2}export interface (\w+)OwnMethods \{$/.exec(line);
    if (ownMethods !== null) {
      accessorsOf = entry(accessors, ownMethods[1]!, () => new Map());
      tagged = {};
      continue;
    }
    const tag = /^ {5}\* @nts(Get|Set) (\S+)$/.exec(line);
    if (tag !== null) {
      tagged = { ...tagged, [tag[1] === "Get" ? "get" : "set"]: tag[2]! };
      continue;
    }
    const property = /^ {4}(?:readonly )?(\w+): [^(]+;$/.exec(line);
    if (property !== null && accessorsOf !== null && (tagged.get !== undefined || tagged.set !== undefined)) {
      accessorsOf.set(property[1]!, tagged);
      tagged = {};
      continue;
    }
    const childMethod = /^ {4}(add|add_row|remove)\(this: (\w+), \w+: (\w+)\): void;$/.exec(line);
    if (childMethod !== null) {
      entry(childMethods, childMethod[2]!, () => new Map()).set(childMethod[1]!, childMethod[3]!);
      continue;
    }
    const setter = /^ {4}(set_\w+|\$ntsPropSet_\w+)\(this: (\w+), \w+: (.+)\): void;$/.exec(line);
    if (setter !== null) {
      entry(setters, setter[2]!, () => new Map()).set(setter[1]!, setter[3]!);
      continue;
    }
    // A detailed signal also takes `"response::cancel"`; its prop connects
    // to the plain name, which hears every detail.
    const signal = /^ {4}connect\(this: Erased<(\w+)>, detailed_signal: "([^"]+)"(?: \| `[\w-]+::\$\{string\}`)?, handler: ErasedClosure</.exec(line);
    const signature = signal === null ? null : readSignature(line);
    if (signal !== null && signature !== null) {
      entry(signals, signal[1]!, () => new Map()).set(signal[2]!, signature);
      continue;
    }
    // `new (props?: GtkButtonProps): GtkButton`, or with the signals a
    // program class may declare, and the interfaces it may implement:
    // `new <Sig ..., Impl ...>(props?: ...): Signalled<GtkButton, Sig, Impl>`.
    const constructor = /^ {4}new (?:<[^>]*>)?\(props\?: (\w+)Props\): (?:Signalled<(\w+)(?:, \w+)+>|(\w+));$/.exec(line);
    const constructed = constructor === null ? undefined : (constructor[2] ?? constructor[3]);
    if (constructed !== undefined && constructor![1] === constructed) {
      constructible.add(constructed);
    }
  }
  const classes = new Set(constructible);
  const boxedTypes = new Set<string>();
  const newable = new Set<string>();
  // Each GObject class's parent and the interfaces it implements, inherited
  // ones included: `GObjectClass<"_GtkSingleSelection", GObject, "_GListModel" | ...>`.
  const gobjectClasses = new Map<string, { parent: string; implements: string[] }>();
  const interfaces = new Set<string>();
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".d.ts"))) {
    let module: string | undefined;
    for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
      const declared = /^declare module "(c:[\w.-]+)" \{$/.exec(line);
      if (declared !== null) {
        module = declared[1]!;
        continue;
      }
      const gobjectClass = /^ {2}export type (\w+) = GObjectClass<"_\w+", (\w+)(?:, ([^>]+))?>/.exec(line);
      if (gobjectClass !== null) {
        const implemented = (gobjectClass[3] ?? "").split("|").map((tag) => tag.trim().replace(/^"_|"$/g, "")).filter((tag) => tag !== "");
        gobjectClasses.set(gobjectClass[1]!, { parent: gobjectClass[2]!, implements: implemented });
      }
      const boxedType = /^ {2}export type (\w+) = Boxed</.exec(line);
      if (boxedType !== null) {
        boxedTypes.add(boxedType[1]!);
      }
      const boxedConstructor = /^ {4}new \([^)]*\): (\w+);$/.exec(line);
      if (boxedConstructor !== null) {
        newable.add(boxedConstructor[1]!);
      }
      const gobjectInterface = /^ {2}export type (\w+) = GObjectInterface</.exec(line);
      if (gobjectInterface !== null) {
        interfaces.add(gobjectInterface[1]!);
      }
      const exported = /^ {2}export (?:type|const|interface|function) (\w+)/.exec(line);
      if (exported !== null && module !== undefined && !modules.has(exported[1]!)) {
        modules.set(exported[1]!, module);
      }
      // Props can be required, when a construct-only one has no default
      // (`GListStore`'s item type): still a class `instanceof` can check.
      const made = /^ {4}new (?:<[^>]*>)?\(props\??: \w+Props\): (?:Signalled<(\w+)(?:, \w+)+>|(\w+));$/.exec(line);
      const abstract = /^ {2}export const (\w+): \(abstract new /.exec(line);
      const name = made?.[1] ?? made?.[2] ?? abstract?.[1];
      if (name !== undefined) {
        classes.add(name);
      }
    }
  }
  const implementers = new Map<string, string[]>();
  for (const name of interfaces) {
    const implementing = (c: string): boolean => classes.has(c) && gobjectClasses.get(c)?.implements.includes(name) === true;
    const all = [...gobjectClasses.keys()].filter(implementing);
    // Topmost: a class whose parent also implements it is covered by the parent's check.
    implementers.set(name, all.filter((c) => !implementing(gobjectClasses.get(c)!.parent)).sort());
  }
  return { setters, childMethods, accessors, getters, signals, constructible, classes, modules, implementers, boxed: boxedTypes, newable };
}

// ---- the model ---------------------------------------------------------------

type ValueKind =
  | { kind: "string"; nullable: boolean }
  // A list of strings: a `CStrings` setter (`cssClasses`).
  | { kind: "strings"; nullable: boolean }
  // `classes` are what `instanceof` checks: the type itself for a class, the
  // classes that implement it for an interface.
  | { kind: "object"; type: string; classes: string[]; nullable: boolean }
  | { kind: "boolean" }
  | { kind: "number" }
  | { kind: "enum"; type: string };

interface Prop {
  jsx: string; // hasFrame
  setter: string; // set_has_frame
  /** For a controlled prop, the getter that reads the widget's own value. */
  controlledBy?: string;
  /** For a prop that names a child (a Stack's visible child), the getter that finds it by that name. */
  namesChildBy?: string;
  value: ValueKind;
  /** The value that restores GTK's default when the prop is removed, or null when there is none to say. */
  reset: string | null;
}

/** A widget-typed property that places a child: filled by a slot element. */
interface Slot {
  jsx: string; // StartChild
  hostType: string; // GtkPaned.StartChild
  setter: string; // set_start_child
  /** The class the slot takes, where it takes one: AdwNavigationPage. */
  holds?: string;
}

interface Signal {
  jsx: string; // onClicked
  name: string; // clicked
  /** The handler's parameters after the widget, typed for the app: `row: GtkListBoxRow`. */
  params: { name: string; type: string }[];
  /** Whether the handler answers whether it handled the signal (GTK's `gboolean`). */
  decides: boolean;
  /** For `notify::x`, the getter that reads the property's new value for the handler. */
  getter?: string;
}

/**
 * A handler parameter's type as an app writes it: an object, a string, a
 * number, a boolean or an enum, without the C spelling (`CNumber<"double">` is
 * `number`); null for one a handler cannot be written against yet. An object
 * is any class, interface or boxed record the bindings declare, in any
 * namespace (a ListBox's row, a TabView's AdwTabPage, a TreeView's
 * GtkTreePath). The bridge copies a boxed record the emission lends into a
 * box of the program's, so a handler may keep it.
 */
function handlerType(type: string, types: Set<string>, bindings: Bindings): string | null {
  const object = /^(\w+)( \| null)?$/.exec(type);
  const name = object === null ? "" : object[1]!;
  if (object !== null && (bindings.classes.has(name) || bindings.implementers.has(name) || bindings.boxed.has(name))) {
    types.add(name);
    return type;
  }
  if (type === "string" || type === "string | null") return type;
  if (/^CNumber<"\w+">$/.test(type)) return "number";
  if (/^CBool<\w+>$/.test(type)) return "boolean";
  const enumType = /^CEnum<(\w+), \w+>$/.exec(type);
  if (enumType !== null) {
    types.add(enumType[1]!);
    return enumType[1]!;
  }
  return null;
}

type ChildProtocol = "none" | "single" | "box" | "list" | "adds";

/** A widget that only adds and removes children: the methods, and the class each takes. */
interface Adds {
  add: string; // add, add_row
  addType: string; // GtkWidget, AdwPreferencesGroup
  removeType: string;
}

/** A GIR class from Widget down, abstract or not: what its own function sets. */
interface WidgetType {
  gir: GirType;
  ts: string; // GtkButton
  jsx: string; // Button
  parent: WidgetType | null; // null for Widget
  props: Prop[];
  signals: Signal[];
  slots: Slot[];
  children: ChildProtocol;
  /** For the "adds" protocol: how it adds and removes. */
  adds?: Adds;
}

/** The nearest class in `t`'s chain, `t` included, with widget slots of its own. */
function slotOwner(t: WidgetType): WidgetType | null {
  let owner: WidgetType | null = t;
  while (owner !== null && owner.slots.length === 0) {
    owner = owner.parent;
  }
  return owner;
}

/** "a" or "an", as `name` is said: "a GtkButton", "an AdwHeaderBar". */
const article = (name: string): string => (/^[AEIOU]/.test(name) ? "an" : "a");

/** `panedSlot` for Paned: the lower-camel name of a class's functions. */
const lower = (t: WidgetType): string => `${t.jsx.charAt(0).toLowerCase()}${t.jsx.slice(1)}`;

const camel = (name: string): string => name.replace(/[-_](\w)/g, (_, c: string) => c.toUpperCase());
/** A type's TypeScript name: its C name, `GtkButton`. */
const tsName = (t: GirType): string => `${t.prefix}${t.name}`;

// A list container's accessor for the row it made for a child, by index: a
// moved child is taken back out of it before the row goes.
// A widget that adds its children with a method other than `add`: an
// ExpanderRow's children are its rows. It comes before a protocol the widget
// inherits.
const addsBy = new Map([["Adw.ExpanderRow", "add_row"]]);

// Widgets whose inherited child protocol is wrong for them, by a class in
// their chain: libadwaita's rows build their own child (GtkListBoxRow's
// `set_child` would replace it), and its windows take their content through
// their Content slot. They take children only through their elements.
const noChildProtocol = new Set(["Adw.PreferencesRow", "Adw.ApplicationWindow", "Adw.Window"]);

const rowAccessors = new Map([
  ["Gtk.ListBox", "get_row_at_index"],
  ["Gtk.FlowBox", "get_child_at_index"],
]);

// The props a user changes, by the GIR type that declares them: a prop given
// to one holds it, as React DOM's `value` and `checked` do (HostNode's
// `readControlled`). Hand-kept: GIR does not say which properties input
// changes.
const controlledProps = new Map([
  ["Gtk.Editable", ["text"]],
  ["Gtk.CheckButton", ["active"]],
  ["Gtk.ToggleButton", ["active"]],
  ["Gtk.Switch", ["active"]],
  ["Gtk.SpinButton", ["value"]],
  ["Gtk.Expander", ["expanded"]],
  ["Gtk.DropDown", ["selected"]],
  ["Gtk.Stack", ["visible-child-name"]],
  ["Gtk.Notebook", ["page"]],
  ["Gtk.Paned", ["position"]],
  ["Gtk.MenuButton", ["active"]],
  ["Gtk.SearchBar", ["search-mode-enabled"]],
  ["Adw.ViewStack", ["visible-child-name"]],
]);

// Widget-typed properties that name another widget rather than place one: an
// app passes a ref's `current` (a host element's public instance is its
// widget). A Stack's visible child is one of its children. The rest of the
// widget-typed ones place a child in a slot (a Paned's start child, a
// window's titlebar): a slot element, whose child React parents.
const widgetReferences = new Set(["mnemonic-widget", "default-widget", "focus-widget", "key-capture-widget", "visible-child"]);

// A property typed as a particular widget class names another widget (a
// StackSwitcher's `stack`, a window's `transientFor`, a TabBar's `view`),
// except these, which place a child of that class: a slot element whose child
// must be one. GIR types both the same way.
const typedSlots = new Map([
  ["Adw.NavigationSplitView", ["sidebar", "content"]],
  ["Adw.PreferencesPage", ["banner"]],
]);

// Children arrive as React children, never as a prop.
const childProps = new Set(["child"]);

// Props that name one of the widget's children, by the GIR type that
// declares them, with the getter that finds a child by that name. React sets
// a node's props before placing its children, so the name can arrive before
// its child: GTK warns and selects nothing, and the child selects itself when
// it is attached (src/children.ts). So such a prop is set only when the child
// exists, and removing it leaves the selection as it is.
const childNamingProps = new Map([
  ["Gtk.Stack", new Map([["visible-child-name", "get_child_by_name"]])],
  ["Adw.ViewStack", new Map([["visible-child-name", "get_child_by_name"]])],
]);

// Containers that place a child with parameters of its own, or in groups,
// through elements written by hand in each module's children.ts (src/, and
// src/adw/): the members their component has, each element's host type and
// node class, and what to say to a widget placed in the container directly.
// A container's subclasses take its elements (a SwitchRow is an ActionRow).
const childElements = new Map([
  ["Gtk.Grid", { members: "GridChildren", elements: [["GtkGrid.Child", "GridChildNode"]], use: "<Grid.Child column row>" }],
  ["Gtk.Stack", { members: "StackChildren", elements: [["GtkStack.Page", "StackPageNode"]], use: "<Stack.Page name>" }],
  ["Gtk.Notebook", { members: "NotebookChildren", elements: [["GtkNotebook.Page", "NotebookPageNode"]], use: "<Notebook.Page tab>" }],
  ["Gtk.HeaderBar", { members: "HeaderBarChildren", elements: [["GtkHeaderBar.Start", "PackNode"], ["GtkHeaderBar.End", "PackNode"]], use: "<HeaderBar.Start> or <HeaderBar.End>" }],
  ["Gtk.ActionBar", { members: "ActionBarChildren", elements: [["GtkActionBar.Start", "PackNode"], ["GtkActionBar.End", "PackNode"]], use: "<ActionBar.Start> or <ActionBar.End>" }],
  ["Gtk.Overlay", { members: "OverlayChildren", elements: [["GtkOverlay.Layer", "OverlayLayerNode"]], use: "<Overlay.Layer>" }],
  ["Gtk.Fixed", { members: "FixedChildren", elements: [["GtkFixed.Child", "FixedChildNode"]], use: "<Fixed.Child x y>" }],
  ["Adw.HeaderBar", { members: "HeaderBarChildren", elements: [["AdwHeaderBar.Start", "AdwGroupNode"], ["AdwHeaderBar.End", "AdwGroupNode"]], use: "<HeaderBar.Start> or <HeaderBar.End>" }],
  ["Adw.ToolbarView", { members: "ToolbarViewChildren", elements: [["AdwToolbarView.Top", "AdwGroupNode"], ["AdwToolbarView.Bottom", "AdwGroupNode"]], use: "<ToolbarView.Top> or <ToolbarView.Bottom>" }],
  ["Adw.ActionRow", { members: "ActionRowChildren", elements: [["AdwActionRow.Prefix", "AdwGroupNode"], ["AdwActionRow.Suffix", "AdwGroupNode"]], use: "<ActionRow.Prefix> or <ActionRow.Suffix>" }],
  ["Adw.ExpanderRow", { members: "ExpanderRowChildren", elements: [["AdwExpanderRow.Prefix", "AdwGroupNode"], ["AdwExpanderRow.Suffix", "AdwGroupNode"]], use: "<ExpanderRow.Prefix> or <ExpanderRow.Suffix>" }],
  ["Adw.ViewStack", { members: "ViewStackChildren", elements: [["AdwViewStack.Page", "ViewStackPageNode"]], use: "<ViewStack.Page name title>" }],
  ["Adw.TabView", { members: "TabViewChildren", elements: [["AdwTabView.Page", "TabViewPageNode"]], use: "<TabView.Page title>" }],
  // A breakpoint holds no child, so it is not where the widget's children go
  // (no `use`): a window's still go in its Content slot.
  ["Adw.Window", { members: "WindowBreakpoints", elements: [["AdwWindow.Breakpoint", "BreakpointNode"]] }],
  ["Adw.ApplicationWindow", { members: "ApplicationWindowBreakpoints", elements: [["AdwApplicationWindow.Breakpoint", "BreakpointNode"]] }],
  ["Adw.BreakpointBin", { members: "BreakpointBinBreakpoints", elements: [["AdwBreakpointBin.Breakpoint", "BreakpointNode"]] }],
  ["Adw.Dialog", { members: "DialogBreakpoints", elements: [["AdwDialog.Breakpoint", "BreakpointNode"]] }],
]);

// Widgets presented over the window of the widget they are rendered in, as a
// window opens over its opener (HostNode.ts): libadwaita's dialogs, which are
// neither children nor windows. The methods that present and close one.
const presented = new Map([["Adw.Dialog", { present: "present", close: "force_close" }]]);

/** How `t` is presented, if a class in its chain is presented; null otherwise. */
function presentedOf(t: WidgetType): { present: string; close: string } | null {
  for (let c: WidgetType | null = t; c !== null; c = c.parent) {
    const how = presented.get(qualified(c.gir));
    if (how !== undefined) {
      return how;
    }
  }
  return null;
}

/** The elements `t` takes: its own class's, or the nearest ancestor's with some. */
function childElementsOf(t: WidgetType): (typeof childElements extends Map<string, infer E> ? E : never) | null {
  for (let c: WidgetType | null = t; c !== null; c = c.parent) {
    const elements = childElements.get(qualified(c.gir));
    if (elements !== undefined) {
      return elements;
    }
  }
  return null;
}

function valueKind(type: string, bindings: Bindings, reference = false): ValueKind | null {
  if (type === "string" || type === "string | null") {
    return { kind: "string", nullable: type.endsWith("null") };
  }
  const strings = /^CStrings<"[\w ]+">( \| null)?$/.exec(type);
  if (strings !== null) {
    return { kind: "strings", nullable: strings[1] !== undefined };
  }
  if (/^CBool<\w+>$/.test(type)) {
    return { kind: "boolean" };
  }
  if (/^CNumber<"\w+">$/.test(type)) {
    return { kind: "number" };
  }
  const enumType = /^CEnum<(\w+), \w+>$/.exec(type);
  if (enumType !== null) {
    return { kind: "enum", type: enumType[1]! };
  }
  // An object the app makes and hands over: a model, an adjustment, a menu.
  // Not a widget, which React makes and an app would need a ref to; not a
  // boxed Pango type, a handle of another kind.
  const object = /^((?:Gtk|Gdk|G|Adw)[A-Z]\w+)( \| null)?$/.exec(type);
  // A boxed record the app makes and hands over: a colour, a font, a
  // rectangle. Its setter may take it as `Const<…>`; the app passes the record.
  const boxed = /^(?:Const<(\w+)>|(\w+))( \| null)?$/.exec(type);
  const boxedName = boxed === null ? undefined : (boxed[1] ?? boxed[2]);
  if (boxedName !== undefined && bindings.boxed.has(boxedName) && bindings.newable.has(boxedName)) {
    return { kind: "object", type: boxedName, classes: [boxedName], nullable: boxed![3] !== undefined };
  }
  if (object === null || (object[1] === "GtkWidget" && !reference)) {
    return null;
  }
  const name = object[1]!;
  const nullable = object[2] !== undefined;
  // A class is checked with `instanceof`. An interface has no value to check
  // against, so a value of one is one of the classes that implement it
  // (a ListView's model is a GtkSingleSelection, a GtkMultiSelection or a
  // GtkNoSelection), and the prop is typed as those: an app's own
  // implementation is refused where it is written, not dropped where it is read.
  if (bindings.classes.has(name)) {
    return { kind: "object", type: name, classes: [name], nullable };
  }
  const implementers = bindings.implementers.get(name);
  if (implementers !== undefined && implementers.length > 0) {
    return { kind: "object", type: name, classes: implementers, nullable };
  }
  return null;
}

/**
 * The class a property listed in `typedSlots` takes. The list is kept by
 * hand, so a property that does not take a class or null (the bindings
 * changed) fails the generator rather than making a slot that cannot be
 * emptied.
 */
function typedSlotClass(where: string, type: string | undefined, bindings: Bindings): string {
  const taken = /^(\w+) \| null$/.exec(type ?? "");
  if (taken === null || !bindings.classes.has(taken[1]!)) {
    throw new Error(`${where} is listed in typedSlots but takes ${type ?? "nothing it has a setter for"}, not a class or null.`);
  }
  return taken[1]!;
}

/**
 * The TypeScript value for a property's GIR default, or null when this kind
 * cannot say it. A string with no default is unset: null where the setter
 * takes null, else the empty string, which is what an unset string property
 * reads as.
 */
function resetValue(value: ValueKind, girDefault: string | undefined, members: Map<string, number>): string | null {
  if (value.kind === "string") {
    return girDefault === undefined || girDefault === "NULL" ? (value.nullable ? "null" : '""') : JSON.stringify(girDefault);
  }
  if (value.kind === "object") {
    // Unset where the setter takes null; otherwise what was set stays.
    return value.nullable ? "null" : null;
  }
  if (value.kind === "strings") {
    // Unset where the setter takes null; an empty list otherwise.
    return value.nullable ? "null" : "[]";
  }
  if (girDefault === undefined) {
    return null;
  }
  switch (value.kind) {
    case "boolean":
      return girDefault === "TRUE" ? "true" : girDefault === "FALSE" ? "false" : null;
    case "number": {
      const n = Number(girDefault);
      return Number.isFinite(n) ? String(n) : null;
    }
    case "object":
    case "strings":
      return null;
    case "enum": {
      // A flags default may be several members joined with `|`.
      let n = 0;
      for (const part of girDefault.split("|").map((p) => p.trim())) {
        const member = /^-?\d+$/.test(part) ? Number(part) : members.get(part);
        if (member === undefined) {
          return null;
        }
        n |= member;
      }
      return String(n);
    }
  }
}

interface Model {
  /** Every class from Widget down, in declaration order: parents first. */
  types: WidgetType[];
  modules: Map<string, string>;
  handlerTypes: Set<string>;
  /** The ones an app can create. */
  widgets: WidgetType[];
  skipped: string[];
}

/** The model of `target`'s widgets (`Gtk`, `Adw`), whose chains may pass through other namespaces. */
function model(gir: Gir, bindings: Bindings, target: string): Model {
  const skipped = new Set<string>();
  // The types handler parameters name, for the generated file to import.
  const handlerTypes = new Set<string>();
  const parentOf = (t: GirType): GirType | undefined => (t.parent === undefined ? undefined : gir.types.get(t.parent));
  const chainOf = function* (t: GirType | undefined): Generator<GirType> {
    for (; t !== undefined; t = parentOf(t)) {
      yield t;
    }
  };
  const isWidget = (t: GirType): boolean => [...chainOf(t)].some((c) => qualified(c) === "Gtk.Widget");

  // A class's own props and signals are its own and those of each interface
  // it is the first in its chain to implement.
  const ownSources = (t: GirType): GirType[] => {
    const inherited = new Set([...chainOf(parentOf(t))].flatMap((c) => c.implements));
    return [t, ...t.implements.filter((i) => !inherited.has(i)).flatMap((i) => gir.types.get(i) ?? [])];
  };

  const types = new Map<string, WidgetType>();
  const typeOf = (t: GirType): WidgetType => {
    const existing = types.get(qualified(t));
    if (existing !== undefined) {
      return existing;
    }
    const parent = qualified(t) === "Gtk.Widget" ? null : typeOf(parentOf(t)!);
    // What another namespace's class leaves out is listed with that namespace.
    const skip = (entry: string): void => {
      if (t.namespace === target) {
        skipped.add(entry);
      }
    };
    const ts = tsName(t);
    const props: Prop[] = [];
    const signals: Signal[] = [];
    const slots: Slot[] = [];
    // A class can redeclare a property of an interface it implements
    // (ListBase's `orientation`, Orientable's): one prop, the class's.
    const declared = new Set<string>();
    for (const source of ownSources(t)) {
      const sourceTs = tsName(source);
      for (const p of source.properties) {
        if (declared.has(p.name)) {
          continue;
        }
        declared.add(p.name);
        const where = `${sourceTs}.${p.name}`;
        // The accessors the bindings name for the property, before GIR's or a
        // derived name: where the class inherits a `set_<prop>` that is
        // another type's, the binder names its own for the property.
        const named = bindings.accessors.get(sourceTs)?.get(p.name.replace(/-/g, "_"));
        const setter = named?.set ?? p.setter ?? `set_${p.name.replace(/-/g, "_")}`;
        const type = bindings.setters.get(sourceTs)?.get(setter);
        if (childProps.has(p.name) || !p.writable) {
          continue;
        }
        const value = type === undefined ? null : valueKind(type, bindings, widgetReferences.has(p.name));
        const holds = typedSlots.get(qualified(source))?.includes(p.name) === true ? typedSlotClass(where, type, bindings) : null;
        if (holds !== null) {
          const jsx = camel(`-${p.name}`);
          slots.push({ jsx, hostType: `${ts}.${jsx}`, setter, holds });
        } else if (p.constructOnly) {
          skip(`${where}\tconstruct-only: a change would need a new widget`);
        } else if (p.deprecated) {
          skip(`${where}\tdeprecated`);
        } else if (type === undefined) {
          skip(`${where}\tno setter in the bindings`);
        } else if (value === null && type === "GtkWidget | null") {
          const jsx = camel(`-${p.name}`);
          slots.push({ jsx, hostType: `${ts}.${jsx}`, setter });
        } else if (value === null && type === "GtkWidget") {
          skip(`${where}\ta widget slot that cannot be emptied: a slot element's child can go`);
        } else if (value === null && bindings.implementers.get(type.replace(/ \| null$/, ""))?.length === 0) {
          skip(`${where}\ta ${type}: an interface only classes the bindings do not declare implement`);
        } else if (value === null) {
          skip(`${where}\ta ${type}, which a JSX attribute does not carry yet`);
        } else {
          const reset = resetValue(value, p.defaultValue, gir.members);
          if (reset === null) {
            skip(`${where}\tremoving it leaves its value: GIR gives no default`);
          }
          // `onNotifyText`: the property changed, from any side, and here is
          // its new value -- what a controlled prop needs to hear.
          const getter = named?.get ?? p.getter ?? `get_${p.name.replace(/-/g, "_")}`;
          const read = bindings.getters.get(sourceTs)?.get(getter);
          const readType = p.readable && read !== undefined ? handlerType(read, handlerTypes, bindings) : null;
          const controlled = readType !== null && controlledProps.get(qualified(source))?.includes(p.name) === true;
          const namesChildBy = childNamingProps.get(qualified(source))?.get(p.name);
          props.push({
            jsx: camel(p.name),
            setter,
            value,
            reset,
            ...(controlled ? { controlledBy: getter } : {}),
            ...(namesChildBy !== undefined ? { namesChildBy } : {}),
          });
          if (readType !== null) {
            signals.push({
              jsx: `onNotify${camel(`-${p.name}`)}`,
              name: `notify::${p.name}`,
              params: [{ name: "value", type: readType }],
              decides: false,
              getter,
            });
          }
        }
      }
      for (const s of source.signals) {
        const where = `${sourceTs}::${s.name}`;
        const signature = bindings.signals.get(sourceTs)?.get(s.name);
        const params = signature?.params.map((p) => ({ name: p.name, type: handlerType(p.type, handlerTypes, bindings) }));
        if (s.deprecated) {
          skip(`${where}\tdeprecated`);
        } else if (signature === undefined || params === undefined) {
          skip(`${where}\tno connect overload in the bindings`);
        } else if (signature.returns !== "void" && !/^CBool<\w+>$/.test(signature.returns)) {
          skip(`${where}\tits handler returns a ${signature.returns}: not generated yet`);
        } else if (s.fillsArgument !== undefined) {
          // The bridge hands a handler its own copy of a record, so what it
          // wrote would not reach GTK.
          skip(`${where}\tits handler fills \`${s.fillsArgument}\`: not generated yet`);
        } else if (params.some((p) => p.type === null)) {
          skip(`${where}\ta handler argument JSX cannot type yet: ${signature.params.map((p) => p.type).join(", ")}`);
        } else {
          signals.push({
            jsx: `on${camel(`-${s.name}`)}`,
            name: s.name,
            params: params.map((p) => ({ name: p.name, type: p.type! })),
            decides: signature.returns !== "void",
          });
        }
      }
    }
    const chain = [...chainOf(t)];
    const has = (method: string): boolean => chain.some((c) => c.methods.has(method));
    const takesChild = chain.some((c) => bindings.setters.get(tsName(c))?.get("set_child") === "GtkWidget | null");
    // A widget that only adds and removes (a PreferencesGroup): the class in
    // its chain that declares the adding method, and what that method takes.
    const addMethod = addsBy.get(qualified(t)) ?? "add";
    const addsFrom = chain.find((c) => bindings.childMethods.get(tsName(c))?.has(addMethod) === true);
    const addsMethods = addsFrom === undefined ? undefined : bindings.childMethods.get(tsName(addsFrom));
    const adds: Adds | undefined =
      addsMethods === undefined || !addsMethods.has("remove")
        ? undefined
        : { add: addMethod, addType: addsMethods.get(addMethod)!, removeType: addsMethods.get("remove")! };
    const children: ChildProtocol =
      adds !== undefined && addsBy.has(qualified(t))
        ? "adds"
        : chain.some((c) => noChildProtocol.has(qualified(c)))
          ? "none"
          : ["append", "remove", "insert_child_after", "reorder_child_after"].every(has)
            ? "box"
            : ["append", "remove", "insert"].every(has) && rowAccessors.has(qualified(t))
              ? "list"
              : takesChild
                ? "single"
                : adds !== undefined
                  ? "adds"
                  : "none";
    const type: WidgetType = { gir: t, ts, jsx: t.name, parent, props, signals, slots, children, ...(children === "adds" ? { adds } : {}) };
    types.set(qualified(t), type);
    return type;
  };

  const widgets = [...gir.types.values()]
    .filter((t) => t.namespace === target && t.kind === "class" && isWidget(t))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(typeOf)
    .filter((w) => !w.gir.abstract && !w.gir.deprecated && bindings.constructible.has(w.ts));
  // Only the classes some widget's chain passes through.
  const used = new Set(widgets.flatMap((w) => [...chainOf(w.gir)].map(qualified)));
  return {
    types: [...types.values()].filter((t) => used.has(qualified(t.gir))),
    widgets,
    modules: bindings.modules,
    handlerTypes,
    skipped: [...skipped].sort(),
  };
}

// ---- output ------------------------------------------------------------------

/** What a generated file is of: a GIR namespace, the library it names, and where the file goes. */
interface Target {
  namespace: string; // Gtk, Adw
  gir: string; // Gtk-4.0
  library: string; // GTK
  version: string; // 4.22.5
  /** From the package directory: `src/widgets.ts` for Gtk, `src/adw/widgets.ts` for another. */
  dir: string;
}

function emit(m: Model, target: Target): string {
  const out: string[] = [];
  const line = (text = ""): void => {
    out.push(text);
  };
  const values = new Set<string>();
  const types = new Set<string>(m.handlerTypes);
  // Gtk's file defines what every widget shares; another namespace's builds on
  // it, naming Gtk's classes' props, functions and slots through `Gtk.`.
  const gtk = target.namespace === "Gtk";
  const local = (t: WidgetType): boolean => t.gir.namespace === target.namespace;
  const ref = (t: WidgetType, name: string): string => (local(t) ? name : `${t.gir.namespace}.${name}`);
  const hostProps = gtk ? "HostProps" : "Gtk.HostProps";
  // A node class names its namespace outside Gtk (\`AdwHeaderBarNode\`, as its
  // host type is \`AdwHeaderBar\`), so a program importing both modules'
  // nodes needs no aliases.
  const nodeClass = (w: WidgetType): string => `${gtk ? "" : target.namespace}${w.jsx}Node`;
  const hostNode = gtk ? "./HostNode.ts" : "../HostNode.ts";
  // What the file takes from HostNode.ts, as it uses it (noUnusedLocals).
  const needs = new Set<string>(["type HostNode", "type SignalSlot", "WidgetNode"]);

  line(`// Generated by tools/gen-widgets.ts from ${target.library} ${target.version} (${target.gir}.gir) and`);
  line("// its bindings. Edit the generator, not this file.");
  line();
  line("__IMPORTS__");
  if (!gtk) {
    line('import * as Gtk from "../widgets.ts";');
  }
  line('import type { HostComponent } from "shared/ReactHostComponent.ts";');
  line("__HOST_NODE__");
  // This module's own elements, from its own children.ts.
  const ownElements = [...childElements].filter(([key]) => key.startsWith(`${target.namespace}.`)).map(([, c]) => c);
  if (ownElements.length > 0) {
    const childImports = [...new Set(ownElements.flatMap((c) => [`type ${c.members}`, ...c.elements.map(([, node]) => node!)]))];
    line(`import { ${childImports.join(", ")} } from "./children.ts";`);
  }
  if (gtk) {
    line('import type { ControllerProps } from "./controllers.ts";');
  }
  line();
  line("// ---- props: what JSX checks -------------------------------------------------");
  if (gtk) {
    line();
    line("export interface HostProps {");
    line("  children?: unknown;");
    line("}");
  }
  for (const t of m.types.filter(local)) {
    line();
    line(`/** \`<${t.jsx}>\`'s props: ${t.ts}'s own properties and signals. */`);
    // Every widget takes the input props, whose controllers GTK adds to any
    // widget (src/controllers.ts); slot and child elements do not.
    line(`export interface ${t.jsx}Props extends ${t.parent === null ? "HostProps, ControllerProps" : ref(t.parent, `${t.parent.jsx}Props`)} {`);
    for (const p of t.props) {
      if (p.value.kind === "enum") {
        types.add(p.value.type);
      } else if (p.value.kind === "object") {
        // Values: `instanceof` checks against them.
        p.value.classes.forEach((c) => values.add(c));
      } else if (p.value.kind === "strings") {
        needs.add("stringsOf");
      }
      // A class can redeclare an ancestor's property with a wider type
      // (AdwPreferencesPage's `name` takes null where GtkWidget's does not):
      // its props keep the ancestor's type so they still extend its props,
      // and the value reaches the class's own setter, first in its switch.
      line(`  ${p.jsx}?: ${inheritedPropType(t, p.jsx) ?? propType(p.value)};`);
    }
    for (const s of t.signals) {
      line(`  ${s.jsx}?: ${handlerSignature(s)};`);
    }
    line("}");
  }

  line();
  line("// ---- components: what JSX names ----------------------------------------------");
  line("//");
  line("// Declared, never defined: the React stage lowers `<Button />` to");
  line('// `jsx("GtkButton", props)`, so a widget costs no component of its own.');
  line("// A widget with slots names its slot elements as members:");
  line('// `<Paned.StartChild>` lowers to `jsx("GtkPaned.StartChild", props)`.');
  for (const t of m.types.filter((t) => local(t) && t.slots.length > 0)) {
    const inherited = t.parent === null ? null : slotOwner(t.parent);
    line();
    line(`/** \`<${t.jsx}>\`'s slot elements: each holds one child, which fills ${t.ts}'s property of that name. */`);
    line(`export interface ${t.jsx}Slots${inherited === null ? "" : ` extends ${ref(inherited, `${inherited.jsx}Slots`)}`} {`);
    for (const slot of t.slots) {
      line(`  readonly ${slot.jsx}: HostComponent<"${slot.hostType}", ${hostProps}>;`);
    }
    line("}");
  }
  for (const w of m.widgets) {
    const owner = slotOwner(w);
    line();
    line(`/** \`<${w.jsx}>\`: ${article(w.ts)} ${w.ts}. */`);
    const members = [owner === null ? null : ref(owner, `${owner.jsx}Slots`), childElementsOf(w)?.members ?? null].filter((m) => m !== null);
    line(`export declare const ${w.jsx}: HostComponent<"${w.ts}", ${w.jsx}Props>${members.map((m) => ` & ${m}`).join("")};`);
  }

  line();
  line("// ---- setting props, one function per class ------------------------------------");
  for (const t of m.types.filter(local)) {
    types.add(t.ts);
    const parentCall = (args: string): string => (t.parent === null ? "false" : `${ref(t.parent, `${lower(t.parent)}Prop`)}(${args})`);
    const fn = lower(t);
    line();
    line(`export function ${fn}Prop(gtk: ${t.ts}, key: string, value: unknown): boolean {`);
    if (t.props.length > 0) {
      line("  switch (key) {");
      for (const p of t.props) {
        line(`    case "${p.jsx}":`);
        line(`      ${assign(p)}`);
        line("      return true;");
      }
      line("  }");
    }
    line(`  return ${parentCall("gtk, key, value")};`);
    line("}");
    line();
    line(`export function ${fn}Signal(gtk: ${t.ts}, key: string, slot: SignalSlot): boolean {`);
    if (t.signals.length > 0) {
      line("  switch (key) {");
      for (const s of t.signals) {
        line(`    case "${s.jsx}":`);
        if (s.getter !== undefined) {
          line(`      gtk.connect("${s.name}", () => {`);
          line(`        slot.dispatch(() => (slot.handler as ${handlerSignature(s)})(gtk.${s.getter}()));`);
          line("      });");
        } else if (s.decides) {
          const args = s.params.map((p) => `_${p.name}`);
          line(`      gtk.connect("${s.name}", (${["_self", ...args].join(", ")}) => slot.decide(() => (slot.handler as ${handlerSignature(s)})(${args.join(", ")})));`);
        } else if (s.params.length === 0) {
          line(`      gtk.connect("${s.name}", () => slot.fire());`);
        } else {
          const args = s.params.map((p) => `_${p.name}`).join(", ");
          line(`      gtk.connect("${s.name}", (_self, ${args}) => {`);
          line(`        slot.dispatch(() => (slot.handler as ${handlerSignature(s)})(${args}));`);
          line("      });");
        }
        line("      return true;");
      }
      line("  }");
    }
    line(`  return ${t.parent === null ? "false" : parentCall("gtk, key, slot").replace(/Prop\(/, "Signal(")};`);
    line("}");
  }

  line();
  line("// ---- filling widget slots, one function per class that has them ---------------");
  for (const t of m.types.filter((t) => local(t) && t.slots.length > 0)) {
    const inherited = t.parent === null ? null : slotOwner(t.parent);
    types.add("GtkWidget");
    line();
    line(`export function ${lower(t)}Slot(gtk: ${t.ts}, slot: string, widget: GtkWidget | null): boolean {`);
    line("  switch (slot) {");
    for (const slot of t.slots) {
      line(`    case "${slot.hostType}":`);
      const holds = slot.holds;
      if (holds === undefined) {
        line(`      gtk.${slot.setter}(widget);`);
      } else {
        values.add(holds);
        line("      if (widget === null) {");
        line(`        gtk.${slot.setter}(null);`);
        line(`      } else if (widget instanceof ${holds}) {`);
        line(`        gtk.${slot.setter}(widget);`);
        line("      } else {");
        line(`        throw new Error("<${t.jsx}.${slot.jsx}> holds a <${holds.replace(/^[A-Z][a-z]+/, "")}>.");`);
        line("      }");
      }
      line("      return true;");
    }
    line("  }");
    line(`  return ${inherited === null ? "false" : `${ref(inherited, `${lower(inherited)}Slot`)}(gtk, slot, widget)`};`);
    line("}");
  }

  // A widget that only adds and removes keeps its children in React's order
  // itself: a child inserted before another takes out what follows and adds
  // it again. A method taking a particular class (a PreferencesPage's groups)
  // takes a child narrowed to it, and refuses any other.
  const emitAdds = (w: WidgetType, adds: Adds): void => {
    const narrowed = (method: string, type: string): string[] => {
      if (type === "GtkWidget") {
        return [`    this.gtk.${method}(child.widget);`];
      }
      values.add(type);
      return [
        "    const widget = child.widget;",
        `    if (!(widget instanceof ${type})) {`,
        `      throw new Error(\`<${w.jsx}> holds ${type.replace(/^[A-Z][a-z]+/, "")}s, not <\${child.name()}>.\`);`,
        "    }",
        `    this.gtk.${method}(widget);`,
      ];
    };
    line("  // It only adds: a child inserted before another takes out what follows");
    line("  // and adds it again, so the order is React's.");
    line("  private readonly items: WidgetNode[] = [];");
    line("  private adds(child: WidgetNode): void {");
    narrowed(adds.add, adds.addType).forEach((l) => line(l));
    line("    this.items.push(child);");
    line("  }");
    line("  private takes(child: WidgetNode): void {");
    line("    const at = this.items.indexOf(child);");
    line("    if (at < 0) {");
    line("      return;");
    line("    }");
    narrowed("remove", adds.removeType).forEach((l) => line(l));
    line("    this.items.splice(at, 1);");
    line("  }");
    line("  protected place(child: WidgetNode): void {");
    line("    this.adds(child);");
    line("  }");
    line("  protected placeBefore(child: WidgetNode, before: WidgetNode): void {");
    line("    this.takes(child);");
    line("    const after = this.items.slice(this.items.indexOf(before));");
    line("    after.forEach((item) => this.takes(item));");
    line("    this.adds(child);");
    line("    after.forEach((item) => this.adds(item));");
    line("  }");
    line("  protected unplace(child: WidgetNode): void {");
    line("    this.takes(child);");
    line("  }");
  };

  line();
  line("// ---- nodes ------------------------------------------------------------------");
  for (const w of m.widgets) {
    values.add(w.ts);
    const fn = `${w.jsx.charAt(0).toLowerCase()}${w.jsx.slice(1)}`;
    line();
    line(`/** \`<${w.jsx}>\`: ${article(w.ts)} ${w.ts}. */`);
    line(`export class ${nodeClass(w)} extends WidgetNode {`);
    line(`  readonly gtk: ${w.ts};`);
    line();
    line("  constructor() {");
    line(`    const gtk = new ${w.ts}();`);
    line(`    super("${w.ts}", gtk);`);
    line("    this.gtk = gtk;");
    line("  }");
    line("  setProp(key: string, value: unknown): boolean {");
    line(`    return ${fn}Prop(this.gtk, key, value);`);
    line("  }");
    line("  connectSignal(key: string, slot: SignalSlot): boolean {");
    line(`    return ${fn}Signal(this.gtk, key, slot);`);
    line("  }");
    const owner = slotOwner(w);
    if (owner !== null) {
      types.add("GtkWidget");
      line("  fillSlot(slot: string, widget: GtkWidget | null): boolean {");
      line(`    return ${ref(owner, `${lower(owner)}Slot`)}(this.gtk, slot, widget);`);
      line("  }");
    }
    const presentedBy = presentedOf(w);
    if (presentedBy !== null) {
      types.add("GtkWidget");
      line("  // Presented over the window of the widget it is rendered in, at commit");
      line("  // (React places a new tree during render, which can be thrown away),");
      line("  // and closed when React takes it out, as a window is opened.");
      line("  private presenter: GtkWidget | null = null;");
      line("  placeIn(parent: WidgetNode, _before: HostNode | null): void {");
      line("    this.presenter = parent.widget;");
      line("  }");
      needs.add("writeAsReact");
      line("  // React's close, not the user's: a dialog reports it as its `close`");
      line("  // response, which no handler hears.");
      line("  takeOutOf(_parent: WidgetNode): void {");
      line(`    writeAsReact(() => this.gtk.${presentedBy.close}());`);
      line("    this.presenter = null;");
      line("  }");
      line("  needsCommitMount(): boolean {");
      line("    return true;");
      line("  }");
      line("  commitMount(): void {");
      line(`    this.gtk.${presentedBy.present}(this.presenter);`);
      line("  }");
    }
    const controlled = [];
    for (let t: WidgetType | null = w; t !== null; t = t.parent) {
      controlled.push(...t.props.filter((p) => p.controlledBy !== undefined));
    }
    if (controlled.length > 0) {
      line("  readControlled(key: string): unknown {");
      line("    switch (key) {");
      for (const p of controlled) {
        line(`      case "${p.jsx}":`);
        line(`        return this.gtk.${p.controlledBy}();`);
      }
      line("    }");
      line("    return undefined;");
      line("  }");
    }
    // Child elements place themselves, beside the widget's own protocol if it
    // has one (an Overlay's main child and its layers); a widget with none
    // says which element to use.
    const elements = childElementsOf(w);
    if (elements !== null && elements.use !== undefined && w.children === "none") {
      line("  protected place(_child: WidgetNode): void {");
      line(`    throw new Error("<${w.jsx}> places a child through ${elements.use}.");`);
      line("  }");
    }
    if (w.children === "single") {
      line("  protected place(child: WidgetNode): void {");
      line("    this.holdOnly(child);");
      line("    this.gtk.set_child(child.widget);");
      line("  }");
      line("  protected unplace(child: WidgetNode): void {");
      line("    this.gtk.set_child(null);");
      line("    this.release(child);");
      line("  }");
    } else if (w.children === "list") {
      needs.add("insertAt");
      types.add("GtkWidget");
      line("  // A list places a child at an index, and holds a child that is not a");
      line("  // row in a row it makes for it: React's order of the children gives the");
      line("  // index, and what the list holds for each is what moves or goes.");
      line("  private readonly items: WidgetNode[] = [];");
      line("  private readonly placed: GtkWidget[] = [];");
      line("  private held(child: WidgetNode): GtkWidget {");
      line("    const parent = child.widget.get_parent();");
      line("    return parent !== null && parent !== this.gtk ? parent : child.widget;");
      line("  }");
      line("  protected place(child: WidgetNode): void {");
      line("    this.gtk.append(child.widget);");
      line("    this.items.push(child);");
      line("    this.placed.push(this.held(child));");
      line("  }");
      line("  protected placeBefore(child: WidgetNode, before: WidgetNode): void {");
      line("    const at = this.items.indexOf(child);");
      line("    if (at >= 0) {");
      line("      // A move. A row the list made is its own: it goes when removed, so the");
      line("      // child is taken back out of it first, and placed anew.");
      line("      if (this.placed[at] !== child.widget) {");
      line(`        this.gtk.${rowAccessors.get(qualified(w.gir))}(at)!.set_child(null);`);
      line("      }");
      line("      this.gtk.remove(this.placed[at]!);");
      line("      this.items.splice(at, 1);");
      line("      this.placed.splice(at, 1);");
      line("    }");
      line("    const index = this.items.indexOf(before);");
      line("    this.gtk.insert(child.widget, index);");
      line("    insertAt(this.items, index, child);");
      line("    insertAt(this.placed, index, this.held(child));");
      line("  }");
      line("  protected unplace(child: WidgetNode): void {");
      line("    const at = this.items.indexOf(child);");
      line("    if (at >= 0) {");
      line("      this.gtk.remove(this.placed[at]!);");
      line("      this.items.splice(at, 1);");
      line("      this.placed.splice(at, 1);");
      line("    }");
      line("  }");
    } else if (w.children === "adds" && w.adds !== undefined) {
      emitAdds(w, w.adds);
    } else if (w.children === "box") {
      line("  protected place(child: WidgetNode): void {");
      line("    this.gtk.append(child.widget);");
      line("  }");
      line("  protected placeBefore(child: WidgetNode, before: WidgetNode): void {");
      line("    // GTK places a child after a sibling; React places it before one. A");
      line("    // child already here is a move -- a keyed list reordered.");
      line("    const after = before.widget.get_prev_sibling();");
      line("    if (child.widget.get_parent() === this.gtk) {");
      line("      if (after !== child.widget) {");
      line("        this.gtk.reorder_child_after(child.widget, after);");
      line("      }");
      line("    } else {");
      line("      this.gtk.insert_child_after(child.widget, after);");
      line("    }");
      line("  }");
      line("  protected unplace(child: WidgetNode): void {");
      line("    this.gtk.remove(child.widget);");
      line("  }");
    }
    line("}");
  }

  line();
  line("/**");
  line(" * A new node for the host type `type` (`GtkButton`, or a slot element's");
  line(" * `GtkPaned.StartChild`), or null when there is no such element.");
  line(" */");
  line("export function createNode(type: string): HostNode | null {");
  line("  switch (type) {");
  for (const w of m.widgets) {
    line(`    case "${w.ts}":`);
    line(`      return new ${nodeClass(w)}();`);
  }
  const ownSlots = m.types.filter((t) => local(t) && t.slots.length > 0);
  for (const t of ownSlots) {
    for (const slot of t.slots) {
      line(`    case "${slot.hostType}":`);
    }
  }
  if (ownSlots.length > 0) {
    needs.add("SlotNode");
    line("      return new SlotNode(type);");
  }
  for (const c of ownElements) {
    for (const [hostType, node] of c.elements) {
      line(`    case "${hostType}":`);
      line(`      return new ${node}(type);`);
    }
  }
  line("  }");
  line("  return null;");
  line("}");
  line();

  // Each name from the module that declares it: Gtk's own, or the namespace
  // the bindings import it from.
  const byModule = new Map<string, string[]>();
  for (const name of [...new Set([...values, ...types])].sort()) {
    const module = m.modules.get(name) ?? "c:Gtk-4.0";
    const names = byModule.get(module) ?? [];
    names.push(values.has(name) ? name : `type ${name}`);
    byModule.set(module, names);
  }
  const imports = [...byModule.keys()].sort().map((module) => `import {\n${byModule.get(module)!.map((n) => `  ${n},`).join("\n")}\n} from "${module}";`);
  const fromHostNode = ["type HostNode", "insertAt", "type SignalSlot", "SlotNode", "stringsOf", "WidgetNode", "writeAsReact"].filter((n) => needs.has(n));
  return out
    .join("\n")
    .replace("__IMPORTS__", imports.join("\n"))
    .replace("__HOST_NODE__", `import { ${fromHostNode.join(", ")} } from "${hostNode}";`);
}

/** The type an ancestor of `t` declares its prop `jsx` with, or null when none does. */
function inheritedPropType(t: WidgetType, jsx: string): string | null {
  for (let ancestor = t.parent; ancestor !== null; ancestor = ancestor.parent) {
    const declared = ancestor.props.find((p) => p.jsx === jsx);
    if (declared !== undefined) {
      return propType(declared.value);
    }
  }
  return null;
}

/** The type of a signal prop's handler: `(row: GtkListBoxRow) => void`. */
function handlerSignature(s: Signal): string {
  return `(${s.params.map((p) => `${p.name}: ${p.type}`).join(", ")}) => ${s.decides ? "boolean" : "void"}`;
}

function propType(value: ValueKind): string {
  switch (value.kind) {
    case "string":
      return value.nullable ? "string | null" : "string";
    case "enum":
      return value.type;
    case "strings":
      return value.nullable ? "readonly string[] | null" : "readonly string[]";
    case "object": {
      const union = value.classes.join(" | ");
      return value.nullable ? `${union} | null` : union;
    }
    default:
      return value.kind;
  }
}

/** The statement that sets `p` from `value`, restoring GTK's default for any other value. */
function assign(p: Prop): string {
  if (p.namesChildBy !== undefined) {
    return `if (typeof value === "string" && gtk.${p.namesChildBy}(value) !== null) gtk.${p.setter}(value);`;
  }
  if (p.value.kind === "object") {
    // A checked narrowing, which a native build reads a GObject back from an
    // erased value by (its GType); an assertion it does not.
    if (p.value.classes.length === 1) {
      return p.reset === null
        ? `if (value instanceof ${p.value.type}) gtk.${p.setter}(value);`
        : `gtk.${p.setter}(value instanceof ${p.value.type} ? value : null);`;
    }
    // One call per implementing class, each with the value narrowed to that
    // class, which the setter's interface parameter accepts. Not one
    // conditional: its type would be a union of the classes, one value of
    // several handle types.
    const calls = p.value.classes.map((c) => `if (value instanceof ${c}) gtk.${p.setter}(value);`);
    return (p.reset === null ? calls : [...calls, `gtk.${p.setter}(null);`]).join("\n      else ");
  }
  if (p.value.kind === "strings") {
    return `gtk.${p.setter}(stringsOf(value) ?? ${p.reset});`;
  }
  const test = p.value.kind === "enum" ? "number" : p.value.kind;
  const valueOf = p.value.kind === "enum" ? `value as ${p.value.type}` : "value";
  if (p.reset === null) {
    return `if (typeof value === "${test}") gtk.${p.setter}(${valueOf});`;
  }
  const reset = p.value.kind === "enum" ? `${p.reset} as ${p.value.type}` : p.reset;
  return `gtk.${p.setter}(typeof value === "${test}" ? ${valueOf} : ${reset});`;
}

// ---- main --------------------------------------------------------------------

const args = process.argv.slice(2);
const bindingsDir = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--namespace");
const namespaceAt = args.indexOf("--namespace");
const girName = namespaceAt >= 0 ? args[namespaceAt + 1] : "Gtk-4.0";
// The namespaces react-gtk generates widgets for: GTK's own, and libraries of
// widgets built on it, each its own module that an app opts into.
const targets = new Map([
  ["Gtk-4.0", { namespace: "Gtk", library: "GTK", pkgConfig: "gtk4", dir: "src", reads: ["Gtk-4.0"] }],
  ["Adw-1", { namespace: "Adw", library: "libadwaita", pkgConfig: "libadwaita-1", dir: "src/adw", reads: ["Gtk-4.0", "Adw-1"] }],
]);
const known = girName === undefined ? undefined : targets.get(girName);
if (bindingsDir === undefined || known === undefined) {
  console.error(`usage: node tools/gen-widgets.ts <bindings dir> [--namespace ${[...targets.keys()].join("|")}] [--check]`);
  process.exit(2);
}
const version = execFileSync("pkg-config", ["--modversion", known.pkgConfig], { encoding: "utf8" }).trim();
const target: Target = { namespace: known.namespace, gir: girName!, library: known.library, version, dir: known.dir };
const gir = readGir(known.reads);
const m = model(gir, readBindings(bindingsDir), target.namespace);
const files = new Map([
  [join(packageDir, target.dir, "widgets.ts"), emit(m, target)],
  [
    join(packageDir, target.dir, "widgets.skipped.txt"),
    `# What tools/gen-widgets.ts left out of ${target.dir}/widgets.ts, and why (${target.library} ${version}).\n${m.skipped.join("\n")}\n`,
  ],
]);
let stale = false;
for (const [path, text] of files) {
  if (!args.includes("--check")) {
    writeFileSync(path, text);
  } else if (!existsSync(path) || readFileSync(path, "utf8") !== text) {
    console.error(`stale: ${path}`);
    stale = true;
  }
}
if (stale) {
  process.exit(1);
}
const own = m.types.filter((t) => t.gir.namespace === target.namespace);
const props = own.reduce((n, t) => n + t.props.length, 0);
const signals = own.reduce((n, t) => n + t.signals.length, 0);
console.log(`${m.widgets.length} widgets over ${own.length} classes: ${props} props, ${signals} signals; ${m.skipped.length} left out`);
