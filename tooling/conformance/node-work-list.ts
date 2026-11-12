import {gitArguments} from "../gate/git-arguments/main.ts";
// A migration starts with upstream imports, not with the files already ported.
// This is an inventory, not a prediction of tests or compiler reach.
//
// node tooling/conformance/node-work-list.ts --before <node checkout> --before-ref <ref>
//   --after <node checkout> --after-ref <ref> --ports <nts checkout>
//   --ports-ref <ref> [--module <name>] --out <report.json>
// Git objects own every input. Missing objects fail by name; this tool never
// fetches, checks out sources, edits upstream tests or fills in dynamic imports.
import {execFileSync} from "node:child_process";
import {mkdirSync, writeFileSync} from "node:fs";
import {dirname, posix, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {parse, tokenizer} from "acorn";

export type Source = {
  identity: {commit: string; version?: string};
  files: ReadonlyMap<string, string>;
  read(path: string): string;
};
type Edge = {from: string; specifier: string; to?: string; line: number};
type Dynamic = {from: string; line: number; expression: string};
type Imports = {edges: Edge[]; dynamic: Dynamic[]; nativeBindings: Edge[]};
type Closure = Imports & {files: string[]};
type Citation = {owner: string; port: string};
type Delta = {path: string; before: string | null; after: string | null; change: string};

/** Reads immutable objects even if the named checkout is edited later. */
export function gitSource(directory: string, ref: string): Source {
  const root = resolve(directory);
  const env = {...process.env, GIT_NO_LAZY_FETCH: "1"};
  const git = (...args: string[]) => {
    try {
      return execFileSync("git", gitArguments(["-C", root, ...args]), {
        env, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      throw new Error(`source ${root}@${ref}: git ${args.join(" ")} could not be read; provision the exact objects first`, {cause: error});
    }
  };
  const commit = git("rev-parse", "--verify", `${ref}^{commit}`).trim();
  const files = new Map<string, string>();
  for (const row of git("ls-tree", "-rz", "--full-tree", commit).split("\0")) {
    if (!row) continue;
    const tab = row.indexOf("\t");
    const [, kind, oid] = row.slice(0, tab).split(" ");
    if (kind === "blob") files.set(row.slice(tab + 1), oid);
  }
  const cache = new Map<string, string>();
  const read = (path: string): string => {
    if (!files.has(path)) throw new Error(`source ${commit}: missing file ${path}`);
    if (!cache.has(path)) cache.set(path, git("cat-file", "blob", files.get(path)!));
    return cache.get(path)!;
  };
  let version: string | undefined;
  if (files.has("src/node_version.h")) {
    const header = read("src/node_version.h");
    const parts = ["MAJOR", "MINOR", "PATCH"].map(part =>
      header.match(new RegExp(`^#define NODE_${part}_VERSION\\s+(\\d+)`, "m"))?.[1]);
    if (parts.some(part => part === undefined)) throw new Error(`source ${commit}: incomplete Node version header`);
    version = parts.join(".");
  }
  return {identity: {commit, ...(version ? {version} : {})}, files, read};
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function literal(value: unknown): string | undefined {
  const node = record(value);
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && Array.isArray(node.expressions) && node.expressions.length === 0) {
    const quasi = Array.isArray(node.quasis) ? record(node.quasis[0]) : undefined;
    const cooked = record(quasi?.value)?.cooked;
    if (typeof cooked === "string") return cooked;
  }
  return undefined;
}

/** Comments and string lookalikes are not import edges. */
export function imports(path: string, text: string): Imports {
  const found: Imports = {edges: [], dynamic: [], nativeBindings: []};
  const ast = parse(text, {
    ecmaVersion: "latest", sourceType: "script", allowHashBang: true,
    allowImportExportEverywhere: true, allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true, locations: true,
  });
  function add(node: Record<string, unknown>, argument: unknown, native = false) {
    const line = Number(record(record(node.loc)?.start)?.line ?? 0);
    const specifier = literal(argument);
    if (specifier !== undefined) (native ? found.nativeBindings : found.edges).push({from: path, specifier, line});
    else found.dynamic.push({from: path, line, expression: text.slice(Number(node.start), Number(node.end))});
  }
  function walk(value: unknown) {
    if (Array.isArray(value)) { for (const child of value) walk(child); return; }
    const node = record(value);
    if (!node) return;
    if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration", "ImportExpression"].includes(String(node.type)) && node.source) add(node, node.source);
    if (node.type === "CallExpression") {
      const callee = record(node.callee);
      if (callee?.type === "Identifier" && ["require", "internalBinding"].includes(String(callee.name))) {
        add(node, Array.isArray(node.arguments) ? node.arguments[0] : undefined, callee.name === "internalBinding");
      }
    }
    for (const [key, child] of Object.entries(node)) if (!["start", "end", "loc"].includes(key)) walk(child);
  }
  walk(ast);
  return found;
}

function resolveImport(source: Source, from: string, specifier: string): string | undefined {
  const name = specifier.replace(/^node:/, "");
  const base = name.startsWith(".") ? posix.join(posix.dirname(from), name) : `lib/${name}`;
  return [base, `${base}.js`, `${base}/index.js`].find(path => source.files.has(path));
}

function closure(source: Source, roots: string[], parsed: Map<string, Imports>): Closure {
  const seen = new Set<string>(), pending = roots.filter(path => source.files.has(path));
  const result: Closure = {files: [], edges: [], dynamic: [], nativeBindings: []};
  while (pending.length) {
    const path = pending.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    if (!/\.[cm]?js$/.test(path)) continue;
    if (!parsed.has(path)) {
      try { parsed.set(path, imports(path, source.read(path))); }
      catch (error) { throw new Error(`cannot parse ${source.identity.commit}:${path}`, {cause: error}); }
    }
    const found = parsed.get(path)!;
    result.dynamic.push(...found.dynamic);
    result.nativeBindings.push(...found.nativeBindings);
    for (const edge of found.edges) {
      const to = resolveImport(source, path, edge.specifier);
      result.edges.push({...edge, ...(to ? {to} : {})});
      if (to && !seen.has(to)) pending.push(to);
    }
  }
  result.files = [...seen].sort();
  return result;
}

function header(text: string, typedOrJavaScript: boolean): string {
  if (typedOrJavaScript) {
    // Import/type-import scaffolding may precede the source citation. Lex its
    // preamble without interpreting TypeScript bodies, and stop at the first
    // executable declaration. Only actual comments can claim a source file.
    const comments: string[] = [];
    const tokens = tokenizer(text, {
      ecmaVersion: "latest", locations: true, allowHashBang: true,
      onComment: (_block, value) => comments.push(value),
    });
    let token = tokens.getToken();
    while (token.type.label === "import") {
      token = tokens.getToken();
      if (["(", "."].includes(token.type.label)) break;
      let nesting = 0;
      while (token.type.label !== "eof" && token.type.label !== ";") {
        if (["{", "[", "("].includes(token.type.label)) nesting++;
        if (["}", "]", ")"].includes(token.type.label)) nesting--;
        const previous = token;
        token = tokens.getToken();
        if (nesting === 0 && previous.type.label === "string" &&
            token.loc!.start.line > previous.loc!.end.line &&
            !["with", "assert"].includes(text.slice(token.start, token.end))) break;
      }
      if (token.type.label === ";") token = tokens.getToken();
    }
    return comments.join("\n");
  }
  let block = false;
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!block && trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("/*") && !trimmed.startsWith("#!")) break;
    lines.push(line);
    if (trimmed.startsWith("/*")) block = true;
    if (line.includes("*/")) block = false;
  }
  return lines.join("\n");
}

function citations(ports: Source): Map<string, Citation[]> {
  const result = new Map<string, Citation[]>();
  for (const port of [...ports.files.keys()].sort()) {
    const match = /^runtime\/node\/([^/]+)\/(?!test\/).+\.(?:ts|c|h|mjs)$/.exec(port);
    if (!match) continue;
    // Braced filenames are a common header citation, e.g. {parse_args,utils}.
    const text = header(ports.read(port), /\.(?:ts|mjs)$/.test(port));
    const expanded = text.replace(/((?:lib|src)\/[\w/.-]*)\{([^}]+)\}([\w.-]*)/g,
      (_whole, prefix: string, names: string, suffix: string) => names.split(",").map(name => prefix + name.trim() + suffix).join(" "));
    for (const hit of expanded.matchAll(/\b(?:lib|src)\/[\w./-]+\.(?:js|cc|h)\b/g)) {
      const entries = result.get(hit[0]) ?? [];
      if (!entries.some(entry => entry.port === port)) entries.push({owner: match[1], port});
      result.set(hit[0], entries);
    }
  }
  return result;
}

function delta(path: string, before: Source, after: Source): Delta {
  const a = before.files.get(path) ?? null, b = after.files.get(path) ?? null;
  return {path, before: a, after: b, change: a === null && b === null ? "absent" : a === b ? "unchanged" : a === null ? "added" : b === null ? "removed" : "changed"};
}

function lines(source: Source, path: string): string[] {
  return source.files.has(path) ? source.read(path).split("\n").map(line => line.trim()).filter(line => line && !line.startsWith("#")) : [];
}

function selectedTests(source: Source, ports: Source, module: string): string[] {
  const root = `runtime/node/${module}/`;
  const pattern = ports.files.has(root + "test-pattern") ? ports.read(root + "test-pattern").trim() : `^test-${module}(-.*)?\\.m?js$`;
  const matcher = new RegExp(pattern);
  const selected = new Set([...source.files.keys()].filter(path => posix.dirname(path) === "test/parallel" && matcher.test(posix.basename(path))));
  for (const entry of lines(ports, root + "extra-tests")) {
    const name = entry.split(":", 1)[0].trim();
    const path = posix.normalize(name.startsWith("test/") ? name : `test/parallel/${name}`);
    if (source.files.has(path)) selected.add(path);
  }
  for (const name of lines(ports, root + "test-suites")) {
    const prefix = name.startsWith("test/") ? name : `test/${name}`;
    for (const path of source.files.keys()) if (path === prefix || posix.dirname(path) === prefix.replace(/\/$/, "") && /^test-.*\.(?:js|mjs)$/.test(posix.basename(path))) selected.add(path);
  }
  return [...selected].sort();
}

/** A file appears once in workItems; module lists are references to it. */
export function workLists(before: Source, after: Source, ports: Source, asked?: string[]) {
  const owners = citations(ports), oldParsed = new Map<string, Imports>(), newParsed = new Map<string, Imports>();
  const available = [...ports.files.keys()].flatMap(path => /^runtime\/node\/([^/]+)\/tsconfig\.json$/.exec(path)?.[1] ?? []).sort();
  const modules = asked?.length ? [...new Set(asked)].sort() : available;
  for (const module of modules) if (!available.includes(module)) throw new Error(`unknown ported module: ${module}`);
  const workItems = new Map<string, ReturnType<typeof item>>();
  function item(path: string) {
    const claims = owners.get(path) ?? [];
    return {...delta(path, before, after), owners: [...new Set(claims.map(claim => claim.owner))].sort(), citations: claims};
  }
  const lists = modules.map(module => {
    const owned = [...owners].filter(([, claims]) => claims.some(claim => claim.owner === module)).map(([path]) => path);
    const roots = [...new Set([`lib/${module}.js`, ...owned.filter(path => path.startsWith("lib/"))])].sort();
    const old = closure(before, roots, oldParsed), now = closure(after, roots, newParsed);
    const native = new Set(owned.filter(path => path.startsWith("src/")));
    // The native entry is required even when an old header forgot to cite it.
    const entry = `src/node_${module}.cc`;
    if (before.files.has(entry) || after.files.has(entry)) native.add(entry);
    const paths = [...new Set([...old.files, ...now.files, ...native])].sort();
    const partition = {own: [] as string[], shared: [] as string[], unported: [] as string[], ambiguous: [] as string[]};
    for (const path of paths) {
      if (!workItems.has(path)) workItems.set(path, item(path));
      const row = workItems.get(path)!;
      if (row.owners.length > 1) partition.ambiguous.push(path);
      if (row.owners.length === 0) partition.unported.push(path);
      else if (row.owners.length === 1 && row.owners[0] === module) partition.own.push(path);
      else partition.shared.push(path);
    }
    const a = selectedTests(before, ports, module), b = selectedTests(after, ports, module);
    const binding = `runtime/node/${module}/bindings.node.mjs`;
    const bindings = ports.files.has(binding) ? imports(binding, ports.read(binding)) : {edges: [], dynamic: [], nativeBindings: []};
    return {
      module, roots, partition, native: [...native].sort(),
      imports: {before: old, after: now, added: now.files.filter(path => !old.files.includes(path)), removed: old.files.filter(path => !now.files.includes(path))},
      tests: {before: a.length, after: b.length, files: [...new Set([...a, ...b])].sort().map(path => delta(path, before, after))},
      api: delta(`doc/api/${module}.md`, before, after),
      loader: {uses: lines(ports, `runtime/node/${module}/uses`), bindings},
    };
  });
  return {
    schema: 1, identities: {before: before.identity, after: after.identity, ports: ports.identity},
    method: "Literal upstream import closure plus header citations and native entry seams. Shared files occur once. Dynamic edges, multiple claims and unported dependencies require judgment; unported is not a non-goal. No pass prediction.",
    examined: {modules: lists.length, distinctWorkFiles: workItems.size, beforeJavaScript: oldParsed.size, afterJavaScript: newParsed.size},
    modules: lists, workItems: [...workItems.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
}

function main(argv: string[]) {
  const options = new Map<string, string[]>();
  const known = new Set(["--before", "--before-ref", "--after", "--after-ref", "--ports", "--ports-ref", "--module", "--out"]);
  for (let at = 0; at < argv.length; at += 2) {
    const key = argv[at], value = argv[at + 1];
    if (!known.has(key) || !value || value.startsWith("--")) throw new Error(`expected a named source/ref, module or output argument; got ${key}`);
    if (key !== "--module" && options.has(key)) throw new Error(`duplicate argument: ${key}`);
    options.set(key, [...options.get(key) ?? [], value]);
  }
  const one = (key: string) => { const value = options.get(key)?.[0]; if (!value) throw new Error(`required argument: ${key}`); return value; };
  const report = workLists(gitSource(one("--before"), one("--before-ref")), gitSource(one("--after"), one("--after-ref")), gitSource(one("--ports"), one("--ports-ref")), options.get("--module"));
  const out = resolve(one("--out")); mkdirSync(dirname(out), {recursive: true});
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(`${report.examined.modules} modules, ${report.examined.distinctWorkFiles} distinct work files; ${out}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
