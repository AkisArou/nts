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
// (`clicked` → `onClicked`), generated when the signal takes no arguments
// beyond the widget. What is left out is listed, with why, in
// src/widgets.skipped.txt.
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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
  setter: string | undefined;
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
      setter: p.attrs.get("setter"),
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
  /** Signals bind-gir declared `connect` for, with a handler that takes only the widget. */
  plainSignals: Map<string, Set<string>>;
  constructible: Set<string>;
  /** The module each type from another namespace comes from: `PangoWrapMode` → `c:Pango-1.0`. */
  modules: Map<string, string>;
}

function readBindings(dir: string): Bindings {
  const setters = new Map<string, Map<string, string>>();
  const plainSignals = new Map<string, Set<string>>();
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
    const setter = /^ {4}(set_\w+)\(this: (\w+), \w+: (.+)\): void;$/.exec(line);
    if (setter !== null) {
      entry(setters, setter[2]!, () => new Map()).set(setter[1]!, setter[3]!);
      continue;
    }
    const signal = /^ {4}connect\(this: Erased<(\w+)>, detailed_signal: "([^"]+)", handler: ErasedClosure<\(self: \w+\) => void,/.exec(line);
    if (signal !== null) {
      entry(plainSignals, signal[1]!, () => new Set()).add(signal[2]!);
      continue;
    }
    const constructor = /^ {4}new \(props\?: (\w+)Props\): (\w+);$/.exec(line);
    if (constructor !== null && constructor[1] === constructor[2]) {
      constructible.add(constructor[2]!);
    }
  }
  return { setters, plainSignals, constructible, modules };
}

// ---- the model ---------------------------------------------------------------

type ValueKind =
  | { kind: "string"; nullable: boolean }
  | { kind: "boolean" }
  | { kind: "number" }
  | { kind: "enum"; type: string };

interface Prop {
  jsx: string; // hasFrame
  setter: string; // set_has_frame
  value: ValueKind;
  /** The value that restores GTK's default when the prop is removed, or null when there is none to say. */
  reset: string | null;
}

interface Signal {
  jsx: string; // onClicked
  name: string; // clicked
}

type ChildProtocol = "none" | "single" | "box";

/** A GIR class from Widget down, abstract or not: what its own function sets. */
interface WidgetType {
  gir: GirType;
  ts: string; // GtkButton
  jsx: string; // Button
  parent: WidgetType | null; // null for Widget
  props: Prop[];
  signals: Signal[];
  children: ChildProtocol;
}

const camel = (name: string): string => name.replace(/[-_](\w)/g, (_, c: string) => c.toUpperCase());
const tsName = (girName: string): string => `Gtk${girName}`;

// Children arrive as React children, never as a prop.
const childProps = new Set(["child"]);

function valueKind(type: string): ValueKind | null {
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
  return enumType === null ? null : { kind: "enum", type: enumType[1]! };
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
  /** The ones an app can create. */
  widgets: WidgetType[];
  skipped: string[];
}

function model(gir: Gir, bindings: Bindings): Model {
  const skipped = new Set<string>();
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
    for (const source of ownSources(t)) {
      const sourceTs = tsName(source.name);
      for (const p of source.properties) {
        const where = `${sourceTs}.${p.name}`;
        const setter = p.setter ?? `set_${p.name.replace(/-/g, "_")}`;
        const type = bindings.setters.get(sourceTs)?.get(setter);
        if (childProps.has(p.name) || !p.writable) {
          continue;
        }
        const value = type === undefined ? null : valueKind(type);
        if (p.constructOnly) {
          skipped.add(`${where}\tconstruct-only: a change would need a new widget`);
        } else if (p.deprecated) {
          skipped.add(`${where}\tdeprecated`);
        } else if (type === undefined) {
          skipped.add(`${where}\tno setter in the bindings`);
        } else if (value === null) {
          skipped.add(`${where}\ta ${type}, which a JSX attribute does not carry yet`);
        } else {
          const reset = resetValue(value, p.defaultValue, gir.members);
          if (reset === null) {
            skipped.add(`${where}\tremoving it leaves its value: GIR gives no default`);
          }
          props.push({ jsx: camel(p.name), setter, value, reset });
        }
      }
      for (const s of source.signals) {
        const where = `${sourceTs}::${s.name}`;
        if (s.deprecated) {
          skipped.add(`${where}\tdeprecated`);
        } else if (s.takesArguments || s.returnsValue) {
          skipped.add(`${where}\ttakes arguments or returns a value: not generated yet`);
        } else if (!bindings.plainSignals.get(sourceTs)?.has(s.name)) {
          skipped.add(`${where}\tno connect overload in the bindings`);
        } else {
          signals.push({ jsx: `on${camel(`-${s.name}`)}`, name: s.name });
        }
      }
    }
    const chain = [...chainOf(t)];
    const has = (method: string): boolean => chain.some((c) => c.methods.has(method));
    const takesChild = chain.some((c) => bindings.setters.get(tsName(c.name))?.get("set_child") === "GtkWidget | null");
    const children: ChildProtocol = ["append", "remove", "insert_child_after", "reorder_child_after"].every(has)
      ? "box"
      : takesChild
        ? "single"
        : "none";
    const type: WidgetType = { gir: t, ts, jsx: t.name, parent, props, signals, children };
    types.set(t.name, type);
    return type;
  };

  const widgets = [...gir.types.values()]
    .filter((t) => t.kind === "class" && isWidget(t))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(typeOf)
    .filter((w) => !w.gir.abstract && !w.gir.deprecated && bindings.constructible.has(w.ts));
  // Only the classes some widget's chain passes through.
  const used = new Set(widgets.flatMap((w) => [...chainOf(w.gir)].map((c) => c.name)));
  return {
    types: [...types.values()].filter((t) => used.has(t.gir.name)),
    widgets,
    modules: bindings.modules,
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
  const types = new Set<string>();

  line(`// Generated by tools/gen-widgets.ts from GTK ${gtkVersion} (Gtk-${gir.version}.gir) and`);
  line("// its bindings. Edit the generator, not this file.");
  line();
  line("__IMPORTS__");
  line('import { HostNode, type SignalSlot } from "./HostNode.ts";');
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
      }
      line(`  ${p.jsx}?: ${propType(p.value)};`);
    }
    for (const s of t.signals) {
      line(`  ${s.jsx}?: () => void;`);
    }
    line("}");
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
        line(`      gtk.connect("${s.name}", () => slot.fire());`);
        line("      return true;");
      }
      line("  }");
    }
    line(`  return ${t.parent === null ? "false" : parentCall("gtk, key, slot").replace(/Prop\(/, "Signal(")};`);
    line("}");
  }

  line();
  line("// ---- nodes ------------------------------------------------------------------");
  for (const w of m.widgets) {
    values.add(w.ts);
    const fn = `${w.jsx.charAt(0).toLowerCase()}${w.jsx.slice(1)}`;
    line();
    line(`/** \`<${w.jsx}>\`: a ${w.ts}. */`);
    line(`export class ${w.jsx}Node extends HostNode {`);
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
    if (w.children === "single") {
      line("  appendChild(child: HostNode): void {");
      line("    this.holdOnly(child);");
      line("    this.gtk.set_child(child.widget);");
      line("  }");
      line("  removeChild(child: HostNode): void {");
      line("    this.gtk.set_child(null);");
      line("    this.release(child);");
      line("  }");
    } else if (w.children === "box") {
      line("  appendChild(child: HostNode): void {");
      line("    this.gtk.append(child.widget);");
      line("  }");
      line("  insertBefore(child: HostNode, before: HostNode): void {");
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
      line("  removeChild(child: HostNode): void {");
      line("    this.gtk.remove(child.widget);");
      line("  }");
    }
    line("}");
  }

  line();
  line("/** A new node for the host type `type` (`GtkButton`), or null when there is no such widget. */");
  line("export function createNode(type: string): HostNode | null {");
  line("  switch (type) {");
  for (const w of m.widgets) {
    line(`    case "${w.ts}":`);
    line(`      return new ${w.jsx}Node();`);
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

function propType(value: ValueKind): string {
  switch (value.kind) {
    case "string":
      return value.nullable ? "string | null" : "string";
    case "enum":
      return value.type;
    default:
      return value.kind;
  }
}

/** The statement that sets `p` from `value`, restoring GTK's default for any other value. */
function assign(p: Prop): string {
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
