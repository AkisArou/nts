// A lint for direct launch sites, not a general process/data-flow analyser.
// Shared builders are tested by jvm-flags.test.ts; this catches literal tool
// names, Java-named executable variables and tools behind resource wrappers.
export type Launch = { line: number; tool: string; code: string };
const TOOLS = new Set(["java", "javac", "javap", "jar", "jmod", "jdeps", "javadoc", "jlink", "d8", "r8", "keytool", "apksigner"]);
const WRAPPERS = new Set(["env", "exec", "nice", "taskset", "timeout", "prlimit", "perf"]);
function tool(word: string): string | undefined {
  const name = word.replace(/^["'`]|["'`]$/g, "").replace(/^\$\{?|\}$/g, "").split(/[\\/]/).at(-1)!.toLowerCase();
  return TOOLS.has(name) ? name : undefined;
}
function bindings(source: string, seeds: Set<string>): Set<string> {
  const result = new Set(seeds);
  const assignments = [...source.matchAll(/(?:\b(?:const|let|export)\s+)?\b([A-Za-z_]\w*)\s*=\s*([^;\n]+)/g)];
  for (let round = 0; round <= assignments.length; round++) {
    const size = result.size;
    for (const [, name, rhs] of assignments) {
      if (rhs.includes("test-vm-flags.txt") || [...result].some(flag => new RegExp(`\\b${flag}\\b`).test(rhs))) result.add(name);
    }
    if (result.size === size) break;
  }
  return result;
}

export function shellLaunches(source: string): Launch[] {
  const flags = bindings(source, new Set());
  const lines = source.replace(/\\\r?\n/g, " ").split("\n");
  const found: Launch[] = [];
  let heredoc: string | undefined;
  for (const [index, raw] of lines.entries()) {
    if (heredoc) { if (raw.trim() === heredoc) heredoc = undefined; continue; }
    const start = /<<-?\s*['"]?([A-Za-z_]\w*)['"]?/.exec(raw);
    if (start) heredoc = start[1];
    if (/^\s*#/.test(raw)) continue;
    // A substitution is a command boundary too: answer=$(java ...).
    for (let code of shellSegments(raw)) {
      code = code.trim().replace(/^(?:(?:if|then|do|!|time)\s+)+/, "");
      const words = code.match(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s]+/g) ?? [];
      while (/^[A-Za-z_]\w*=/.test(words[0] ?? "")) words.shift();
      if (!words.length || /^(?:command\s+-v|which)\b/.test(code)) continue;
      const first = words[0].replace(/^["']|["']$/g, "");
      const at = tool(words[0]) ? 0 : WRAPPERS.has(first) ? words.findIndex(word => tool(word)) : -1;
      if (at < 0) continue;
      const name = tool(words[at])!;
      const shared = words.slice(at + 1).some(word => [...flags].some(flag =>
        !flag.endsWith("_file") && new RegExp(`\\$\\{?${flag}\\b`).test(word)));
      if (!shared) found.push({ line: index + 1, tool: name, code });
    }
  }
  return found;
}

function shellSegments(line: string): string[] {
  const result: string[] = [], parents: (string | undefined)[] = [];
  let quote: string | undefined, current = "";
  const flush = () => { result.push(current); current = ""; };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && quote !== "'") { current += c + (line[++i] ?? ""); continue; }
    if (c === "$" && line[i + 1] === "(" && quote !== "'") {
      flush(); parents.push(quote); quote = undefined; i++; continue;
    }
    if (quote) { current += c; if (c === quote) quote = undefined; continue; }
    if (c === "'" || c === '"') { quote = c; current += c; continue; }
    if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) break;
    if (c === ")" && parents.length) { flush(); quote = parents.pop(); continue; }
    if (/[;|&()]/.test(c)) { flush(); continue; }
    current += c;
  }
  flush(); return result;
}

type Token = { value: string; string: boolean; offset: number };
function tokens(source: string): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < source.length;) {
    if (/\s/.test(source[i])) { i++; continue; }
    if (source.startsWith("//", i)) { i = source.indexOf("\n", i); if (i < 0) break; continue; }
    if (source.startsWith("/*", i)) {
      let depth = 1; i += 2;
      while (i < source.length && depth) {
        if (source.startsWith("/*", i)) { depth++; i += 2; }
        else if (source.startsWith("*/", i)) { depth--; i += 2; }
        else i++;
      }
      continue;
    }
    const raw = /^r(#+)?"/.exec(source.slice(i));
    if (raw) {
      const end = source.indexOf('"' + (raw[1] ?? ""), i + raw[0].length);
      if (end < 0) break;
      out.push({ value: source.slice(i + raw[0].length, end), string: true, offset: i });
      i = end + 1 + (raw[1]?.length ?? 0); continue;
    }
    const quoted = /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)/.exec(source.slice(i));
    if (quoted) { out.push({ value: quoted[0].slice(1, -1), string: true, offset: i }); i += quoted[0].length; continue; }
    const token = /^[A-Za-z_$][\w$]*|^::|^./s.exec(source.slice(i))![0];
    out.push({ value: token, string: false, offset: i }); i += token.length;
  }
  return out;
}
function callEnd(ts: Token[], start: number): number {
  let depth = 1;
  for (let i = start + 1; i < ts.length; i++) {
    if (ts[i].string) continue;
    if (ts[i].value === "(") depth++;
    if (ts[i].value === ")" && --depth === 0) return i;
  }
  return ts.length - 1;
}
type Alias = { name: string; offset: number; tool?: string };
function executableAliases(ts: Token[]): Alias[] {
  const aliases: Alias[] = [];
  for (let i = 0; i < ts.length; i++) {
    if (ts[i].string || !["let", "const"].includes(ts[i].value)) continue;
    let name = i + 1;
    if (ts[name]?.value === "mut") name++;
    if (!/^[A-Za-z_$]\w*$/.test(ts[name]?.value ?? "")) continue;
    let equal = name + 1;
    while (equal < ts.length && !["=", ";"].includes(ts[equal].value)) equal++;
    if (ts[equal]?.value !== "=") continue;
    let end = equal + 1;
    while (end < ts.length && (ts[end].string || ts[end].value !== ";")) end++;
    const rhs = ts.slice(equal + 1, end);
    const firstCall = rhs.findIndex(t => !t.string && t.value === "(");
    const resolver = rhs[firstCall - 1]?.value;
    const direct = rhs[0]?.string ? tool(rhs[0].value) : undefined;
    const value = direct ?? (["tool", "java_tool", "join", "resolve"].includes(resolver)
      ? rhs.filter(t => t.string).map(t => tool(t.value)).find(Boolean) : undefined);
    aliases.push({ name: ts[name].value, offset: ts[i].offset, tool: value });
  }
  return aliases;
}
function known(ts: Token[], aliases: Alias[], offset: number): string | undefined {
  for (const token of ts) {
    const direct = tool(token.value);
    if (direct) return direct;
    if (!token.string) {
      const binding = aliases.findLast(a => a.name === token.value && a.offset < offset);
      if (binding?.tool) return binding.tool;
    }
  }
}
export function codeLaunches(source: string, rust: boolean): Launch[] {
  const ts = tokens(source), found: Launch[] = [];
  const aliases = executableAliases(ts);
  const flags = new Set(["VM_FLAGS", "vmToolFlags"]);
  for (let round = 0; round < 8; round++) {
    for (let i = 0; i < ts.length - 3; i++) {
      if (!["let", "const"].includes(ts[i].value) || ts[i + 2].value !== "=") continue;
      let end = i + 3;
      while (end < ts.length && (ts[end].string || ts[end].value !== ";")) end++;
      if (ts.slice(i + 3, end).some(t => !t.string && flags.has(t.value))) flags.add(ts[i + 1].value);
    }
  }
  for (let i = 0; i < ts.length; i++) {
    if (ts[i].string || ts[i].value !== "(") continue;
    const name = ts[i - 1]?.value;
    const constructor = rust && name === "new" && ts[i - 2]?.value === "::" && ts[i - 3]?.value === "Command";
    if (!constructor && (rust || !["spawn", "spawnSync", "execFile", "execFileSync", "execSync", "run"].includes(name))) continue;
    const end = callEnd(ts, i), args = ts.slice(i + 1, end);
    let boundary = args.findIndex(t => !t.string && t.value === ",");
    if (boundary < 0) boundary = args.length;
    let first = args.slice(0, boundary), invocation = args;
    // Rust's Command builder adds args in subsequent calls, up to its statement.
    if (constructor) {
      let last = end + 1;
      while (last < ts.length && ts[last].value !== ";") last++;
      invocation = ts.slice(i + 1, last);
      if (first[0]?.string && WRAPPERS.has(first[0].value)) first = invocation;
    }
    const executable = known(first, aliases, ts[i].offset);
    if (!executable) continue;
    const shared = rust ? invocation.some(t => !t.string && t.value === "vm_flags")
      : args.slice(boundary + 1).some(t => !t.string && flags.has(t.value));
    if (!shared) found.push({ line: source.slice(0, ts[i].offset).split("\n").length, tool: executable,
      code: source.slice(ts[i - 1].offset, ts[end].offset + 1).replace(/\s+/g, " ") });
  }
  return found;
}

export function unsharedLaunches(path: string, source: string): Launch[] {
  return path.endsWith(".sh") ? shellLaunches(source) : codeLaunches(source, path.endsWith(".rs"));
}
