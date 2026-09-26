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
// setter, whose value a JSX attribute can carry: a string, a boolean, a number
// or an enum. Its name is the property's in camel case (`has-frame` →
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
  deprecated: boolean;
}

interface GirType {
  name: string;
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
  types: Map<string, GirType>;
  /** Every enum and flags member's value, by its C identifier, across namespaces. */
  members: Map<string, number>;
}

function readGir(): Gir {
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
    for (const element of namespace.children) {
      if (element.name === "enumeration" || element.name === "bitfield") {
        for (const member of element.children.filter((c) => c.name === "member")) {
          members.set(member.attrs.get("c:identifier")!, Number(member.attrs.get("value")));
        }
      }
      if (primary && (element.name === "class" || element.name === "interface")) {
        types.set(element.attrs.get("name")!, readType(element));
      }
    }
    if (primary) {
      version = namespace.attrs.get("version") ?? "";
    }
  };
  load("Gtk-4.0.gir", true);
  return { version, types, members };
}

function readType(element: XmlElement): GirType {
  const flag = (e: XmlElement, name: string): boolean => e.attrs.get(name) === "1";
  const children = (name: string): XmlElement[] => element.children.filter((c) => c.name === name);
  return {
    name: element.attrs.get("name")!,
    kind: element.name === "class" ? "class" : "interface",
    parent: element.attrs.get("parent"),
    abstract: flag(element, "abstract"),
    deprecated: flag(element, "deprecated"),
    implements: children("implements").map((c) => c.attrs.get("name")!),
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
  for (const line of readFileSync(join(dir, "Gtk-4.0.d.ts"), "utf8").split("\n")) {
    const imports = /^ {2}import type \{ (.+) \} from "(c:[\w.-]+)";$/.exec(line);
    if (imports !== null) {
      imports[1]!.split(", ").forEach((name) => modules.set(name, imports[2]!));
      continue;
    }
    const getter = /^ {4}(get_\w+)\(this: (\w+)\): (.+);$/.exec(line);
    if (getter !== null) {
      entry(getters, getter[2]!, () => new Map()).set(getter[1]!, getter[3]!);
      continue;
    }
    const setter = /^ {4}(set_\w+)\(this: (\w+), \w+: (.+)\): void;$/.exec(line);
    if (setter !== null) {
      entry(setters, setter[2]!, () => new Map()).set(setter[1]!, setter[3]!);
      continue;
    }
    const signal = /^ {4}connect\(this: Erased<(\w+)>, detailed_signal: "([^"]+)", handler: ErasedClosure</.exec(line);
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
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".d.ts"))) {
    for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
      const made = /^ {4}new (?:<[^>]*>)?\(props\?: \w+Props\): (?:Signalled<(\w+)(?:, \w+)+>|(\w+));$/.exec(line);
      const abstract = /^ {2}export const (\w+): \(abstract new /.exec(line);
      const name = made?.[1] ?? made?.[2] ?? abstract?.[1];
      if (name !== undefined) {
        classes.add(name);
      }
    }
  }
  return { setters, getters, signals, constructible, classes, modules };
}

// ---- the model ---------------------------------------------------------------

type ValueKind =
  | { kind: "string"; nullable: boolean }
  | { kind: "object"; type: string; nullable: boolean }
  | { kind: "boolean" }
  | { kind: "number" }
  | { kind: "enum"; type: string };

interface Prop {
  jsx: string; // hasFrame
  setter: string; // set_has_frame
  /** For a controlled prop, the getter that reads the widget's own value. */
  controlledBy?: string;
  value: ValueKind;
  /** The value that restores GTK's default when the prop is removed, or null when there is none to say. */
  reset: string | null;
}

/** A widget-typed property that places a child: filled by a slot element. */
interface Slot {
  jsx: string; // StartChild
  hostType: string; // GtkPaned.StartChild
  setter: string; // set_start_child
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
 * A handler parameter's type as an app writes it: a widget, a string, a
 * number, a boolean or an enum, without the C spelling (`CNumber<"double">` is
 * `number`); null for one a handler cannot be written against yet.
 */
function handlerType(type: string, types: Set<string>): string | null {
  const widget = /^(Gtk\w+)( \| null)?$/.exec(type);
  if (widget !== null) {
    types.add(widget[1]!);
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

type ChildProtocol = "none" | "single" | "box" | "list";

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
}

/** The nearest class in `t`'s chain, `t` included, with widget slots of its own. */
function slotOwner(t: WidgetType): WidgetType | null {
  let owner: WidgetType | null = t;
  while (owner !== null && owner.slots.length === 0) {
    owner = owner.parent;
  }
  return owner;
}

/** `panedSlot` for Paned: the lower-camel name of a class's functions. */
const lower = (t: WidgetType): string => `${t.jsx.charAt(0).toLowerCase()}${t.jsx.slice(1)}`;

const camel = (name: string): string => name.replace(/[-_](\w)/g, (_, c: string) => c.toUpperCase());
const tsName = (girName: string): string => `Gtk${girName}`;

// A list container's accessor for the row it made for a child, by index: a
// moved child is taken back out of it before the row goes.
const rowAccessors = new Map([
  ["ListBox", "get_row_at_index"],
  ["FlowBox", "get_child_at_index"],
]);

// The props a user changes, by the GIR type that declares them: a prop given
// to one holds it, as React DOM's `value` and `checked` do (HostNode's
// `readControlled`). Hand-kept: GIR does not say which properties input
// changes.
const controlledProps = new Map([
  ["Editable", ["text"]],
  ["CheckButton", ["active"]],
  ["ToggleButton", ["active"]],
  ["Switch", ["active"]],
  ["SpinButton", ["value"]],
  ["Expander", ["expanded"]],
  ["DropDown", ["selected"]],
]);

// Widget-typed properties that name another widget rather than place one: an
// app passes a ref's `current` (a host element's public instance is its
// widget). A Stack's visible child is one of its children. The rest of the
// widget-typed ones place a child in a slot (a Paned's start child, a
// window's titlebar): a slot element, whose child React parents.
const widgetReferences = new Set(["mnemonic-widget", "default-widget", "focus-widget", "key-capture-widget", "visible-child"]);

// Children arrive as React children, never as a prop.
const childProps = new Set(["child"]);

function valueKind(type: string, classes: Set<string>, reference = false): ValueKind | null {
  if (type === "string" || type === "string | null") {
    return { kind: "string", nullable: type.endsWith("null") };
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
  const object = /^((?:Gtk|Gdk|G)[A-Z]\w+)( \| null)?$/.exec(type);
  // A class, since the narrowing is `instanceof`: an interface has no value.
  if (object !== null && (object[1] !== "GtkWidget" || reference) && classes.has(object[1]!)) {
    return { kind: "object", type: object[1]!, nullable: object[2] !== undefined };
  }
  return null;
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

function model(gir: Gir, bindings: Bindings): Model {
  const skipped = new Set<string>();
  // The types handler parameters name, for the generated file to import.
  const handlerTypes = new Set<string>();
  const parentOf = (t: GirType): GirType | undefined => (t.parent === undefined ? undefined : gir.types.get(t.parent));
  const chainOf = function* (t: GirType | undefined): Generator<GirType> {
    for (; t !== undefined; t = parentOf(t)) {
      yield t;
    }
  };
  const isWidget = (t: GirType): boolean => [...chainOf(t)].some((c) => c.name === "Widget");

  // A class's own props and signals are its own and those of each interface
  // it is the first in its chain to implement.
  const ownSources = (t: GirType): GirType[] => {
    const inherited = new Set([...chainOf(parentOf(t))].flatMap((c) => c.implements));
    return [t, ...t.implements.filter((i) => !inherited.has(i)).flatMap((i) => gir.types.get(i) ?? [])];
  };

  const types = new Map<string, WidgetType>();
  const typeOf = (t: GirType): WidgetType => {
    const existing = types.get(t.name);
    if (existing !== undefined) {
      return existing;
    }
    const parent = t.name === "Widget" ? null : typeOf(parentOf(t)!);
    const ts = tsName(t.name);
    const props: Prop[] = [];
    const signals: Signal[] = [];
    const slots: Slot[] = [];
    // A class can redeclare a property of an interface it implements
    // (ListBase's `orientation`, Orientable's): one prop, the class's.
    const declared = new Set<string>();
    for (const source of ownSources(t)) {
      const sourceTs = tsName(source.name);
      for (const p of source.properties) {
        if (declared.has(p.name)) {
          continue;
        }
        declared.add(p.name);
        const where = `${sourceTs}.${p.name}`;
        const setter = p.setter ?? `set_${p.name.replace(/-/g, "_")}`;
        const type = bindings.setters.get(sourceTs)?.get(setter);
        if (childProps.has(p.name) || !p.writable) {
          continue;
        }
        const value = type === undefined ? null : valueKind(type, bindings.classes, widgetReferences.has(p.name));
        if (p.constructOnly) {
          skipped.add(`${where}\tconstruct-only: a change would need a new widget`);
        } else if (p.deprecated) {
          skipped.add(`${where}\tdeprecated`);
        } else if (type === undefined) {
          skipped.add(`${where}\tno setter in the bindings`);
        } else if (value === null && type === "GtkWidget | null") {
          const jsx = camel(`-${p.name}`);
          slots.push({ jsx, hostType: `${ts}.${jsx}`, setter });
        } else if (value === null && type === "GtkWidget") {
          skipped.add(`${where}\ta widget slot that cannot be emptied: a slot element's child can go`);
        } else if (value === null) {
          skipped.add(`${where}\ta ${type}, which a JSX attribute does not carry yet`);
        } else {
          const reset = resetValue(value, p.defaultValue, gir.members);
          if (reset === null) {
            skipped.add(`${where}\tremoving it leaves its value: GIR gives no default`);
          }
          // `onNotifyText`: the property changed, from any side, and here is
          // its new value -- what a controlled prop needs to hear.
          const getter = p.getter ?? `get_${p.name.replace(/-/g, "_")}`;
          const read = bindings.getters.get(sourceTs)?.get(getter);
          const readType = p.readable && read !== undefined ? handlerType(read, handlerTypes) : null;
          const controlled = readType !== null && controlledProps.get(source.name)?.includes(p.name) === true;
          props.push({ jsx: camel(p.name), setter, value, reset, ...(controlled ? { controlledBy: getter } : {}) });
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
        const params = signature?.params.map((p) => ({ name: p.name, type: handlerType(p.type, handlerTypes) }));
        if (s.deprecated) {
          skipped.add(`${where}\tdeprecated`);
        } else if (signature === undefined || params === undefined) {
          skipped.add(`${where}\tno connect overload in the bindings`);
        } else if (signature.returns !== "void" && !/^CBool<\w+>$/.test(signature.returns)) {
          skipped.add(`${where}\tits handler returns a ${signature.returns}: not generated yet`);
        } else if (params.some((p) => p.type === null)) {
          skipped.add(`${where}\ta handler argument JSX cannot type yet: ${signature.params.map((p) => p.type).join(", ")}`);
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
    const takesChild = chain.some((c) => bindings.setters.get(tsName(c.name))?.get("set_child") === "GtkWidget | null");
    const children: ChildProtocol = ["append", "remove", "insert_child_after", "reorder_child_after"].every(has)
      ? "box"
      : ["append", "remove", "insert"].every(has) && rowAccessors.has(t.name)
        ? "list"
        : takesChild
          ? "single"
          : "none";
    const type: WidgetType = { gir: t, ts, jsx: t.name, parent, props, signals, slots, children };
    types.set(t.name, type);
    return type;
  };

  const widgets = [...gir.types.values()]
    .filter((t) => t.kind === "class" && isWidget(t))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(typeOf)
    .filter((w) => !w.gir.abstract && !w.gir.deprecated && bindings.constructible.has(w.ts));
  // A widget that places children by index would need to find a slot
  // element's place among them (WidgetNode.insertBefore): none has slots.
  for (const w of widgets) {
    if ((w.children === "box" || w.children === "list") && slotOwner(w) !== null) {
      throw new Error(`${w.ts} places children by index and has widget slots: WidgetNode.insertBefore would misplace one`);
    }
  }
  // Only the classes some widget's chain passes through.
  const used = new Set(widgets.flatMap((w) => [...chainOf(w.gir)].map((c) => c.name)));
  return {
    types: [...types.values()].filter((t) => used.has(t.gir.name)),
    widgets,
    modules: bindings.modules,
    handlerTypes,
    skipped: [...skipped].sort(),
  };
}

// ---- output ------------------------------------------------------------------

function emit(gir: Gir, m: Model, gtkVersion: string): string {
  const out: string[] = [];
  const line = (text = ""): void => {
    out.push(text);
  };
  const values = new Set<string>();
  const types = new Set<string>(m.handlerTypes);

  line(`// Generated by tools/gen-widgets.ts from GTK ${gtkVersion} (Gtk-${gir.version}.gir) and`);
  line("// its bindings. Edit the generator, not this file.");
  line();
  line("__IMPORTS__");
  line('import type { HostComponent } from "shared/ReactHostComponent.ts";');
  line('import { type HostNode, insertAt, type SignalSlot, SlotNode, WidgetNode } from "./HostNode.ts";');
  line();
  line("// ---- props: what JSX checks -------------------------------------------------");
  line();
  line("export interface HostProps {");
  line("  children?: unknown;");
  line("}");
  for (const t of m.types) {
    line();
    line(`/** \`<${t.jsx}>\`'s props: ${t.ts}'s own properties and signals. */`);
    line(`export interface ${t.jsx}Props extends ${t.parent === null ? "HostProps" : `${t.parent.jsx}Props`} {`);
    for (const p of t.props) {
      if (p.value.kind === "enum") {
        types.add(p.value.type);
      } else if (p.value.kind === "object") {
        // A value: `instanceof` checks against it.
        values.add(p.value.type);
      }
      line(`  ${p.jsx}?: ${propType(p.value)};`);
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
  for (const t of m.types.filter((t) => t.slots.length > 0)) {
    const inherited = t.parent === null ? null : slotOwner(t.parent);
    line();
    line(`/** \`<${t.jsx}>\`'s slot elements: each holds one child, which fills ${t.ts}'s property of that name. */`);
    line(`export interface ${t.jsx}Slots${inherited === null ? "" : ` extends ${inherited.jsx}Slots`} {`);
    for (const slot of t.slots) {
      line(`  readonly ${slot.jsx}: HostComponent<"${slot.hostType}", HostProps>;`);
    }
    line("}");
  }
  for (const w of m.widgets) {
    const owner = slotOwner(w);
    line();
    line(`/** \`<${w.jsx}>\`: a ${w.ts}. */`);
    line(`export declare const ${w.jsx}: HostComponent<"${w.ts}", ${w.jsx}Props>${owner === null ? "" : ` & ${owner.jsx}Slots`};`);
  }

  line();
  line("// ---- setting props, one function per class ------------------------------------");
  for (const t of m.types) {
    types.add(t.ts);
    const parentCall = (args: string): string => (t.parent === null ? "false" : `${t.parent.jsx.charAt(0).toLowerCase()}${t.parent.jsx.slice(1)}Prop(${args})`);
    const fn = `${t.jsx.charAt(0).toLowerCase()}${t.jsx.slice(1)}`;
    line();
    line(`function ${fn}Prop(gtk: ${t.ts}, key: string, value: unknown): boolean {`);
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
    line(`function ${fn}Signal(gtk: ${t.ts}, key: string, slot: SignalSlot): boolean {`);
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
  for (const t of m.types.filter((t) => t.slots.length > 0)) {
    const inherited = t.parent === null ? null : slotOwner(t.parent);
    line();
    line(`function ${lower(t)}Slot(gtk: ${t.ts}, slot: string, widget: GtkWidget | null): boolean {`);
    line("  switch (slot) {");
    for (const slot of t.slots) {
      line(`    case "${slot.hostType}":`);
      line(`      gtk.${slot.setter}(widget);`);
      line("      return true;");
    }
    line("  }");
    line(`  return ${inherited === null ? "false" : `${lower(inherited)}Slot(gtk, slot, widget)`};`);
    line("}");
  }

  line();
  line("// ---- nodes ------------------------------------------------------------------");
  for (const w of m.widgets) {
    values.add(w.ts);
    const fn = `${w.jsx.charAt(0).toLowerCase()}${w.jsx.slice(1)}`;
    line();
    line(`/** \`<${w.jsx}>\`: a ${w.ts}. */`);
    line(`export class ${w.jsx}Node extends WidgetNode {`);
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
      line("  fillSlot(slot: string, widget: GtkWidget | null): boolean {");
      line(`    return ${lower(owner)}Slot(this.gtk, slot, widget);`);
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
      line(`        this.gtk.${rowAccessors.get(w.jsx)}(at)!.set_child(null);`);
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
    line(`      return new ${w.jsx}Node();`);
  }
  for (const t of m.types) {
    for (const slot of t.slots) {
      line(`    case "${slot.hostType}":`);
    }
  }
  if (m.types.some((t) => t.slots.length > 0)) {
    line("      return new SlotNode(type);");
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
  return out.join("\n").replace("__IMPORTS__", imports.join("\n"));
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
    case "object":
      return value.nullable ? `${value.type} | null` : value.type;
    default:
      return value.kind;
  }
}

/** The statement that sets `p` from `value`, restoring GTK's default for any other value. */
function assign(p: Prop): string {
  if (p.value.kind === "object") {
    // A checked narrowing, which a native build reads a GObject back from an
    // erased value by (its GType); an assertion it does not.
    return p.reset === null
      ? `if (value instanceof ${p.value.type}) gtk.${p.setter}(value);`
      : `gtk.${p.setter}(value instanceof ${p.value.type} ? value : null);`;
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
const bindingsDir = args.find((a) => !a.startsWith("--"));
if (bindingsDir === undefined) {
  console.error("usage: node tools/gen-widgets.ts <bindings dir> [--check]");
  process.exit(2);
}
const gir = readGir();
const m = model(gir, readBindings(bindingsDir));
const gtkVersion = execFileSync("pkg-config", ["--modversion", "gtk4"], { encoding: "utf8" }).trim();
const files = new Map([
  [join(packageDir, "src/widgets.ts"), emit(gir, m, gtkVersion)],
  [join(packageDir, "src/widgets.skipped.txt"), `# What tools/gen-widgets.ts left out of src/widgets.ts, and why (GTK ${gtkVersion}).\n${m.skipped.join("\n")}\n`],
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
const props = m.types.reduce((n, t) => n + t.props.length, 0);
const signals = m.types.reduce((n, t) => n + t.signals.length, 0);
console.log(`${m.widgets.length} widgets over ${m.types.length} classes: ${props} props, ${signals} signals; ${m.skipped.length} left out`);
