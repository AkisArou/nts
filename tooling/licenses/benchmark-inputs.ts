// CC-BY-4.0 is admitted only as opaque benchmark input. In particular, an
// unpacker is executable code even when its package calls it a data package.
// Each case owns input-licenses.json; no central row needs to be merged when
// two independent cases vendor data. This audit never executes upstream code.
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, lstatSync, readFileSync, realpathSync} from "node:fs";
import {basename, dirname, isAbsolute, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {API, type Project} from "typescript/unstable/sync";
import {SyntaxKind, isImportDeclaration, isExportDeclaration, isImportEqualsDeclaration, isExternalModuleReference, isStringLiteralLikeNode, isCallExpression, isIdentifier, isPropertyAccessExpression, type Node} from "typescript/unstable/ast";

export const INPUT_MANIFEST = "input-licenses.json";
type File = {path: string; sha256: string};
type Input = {
  directory: string;
  upstream: string;
  license: File & {spdx: "CC-BY-4.0"};
  provenance: {path: string; attribution: string};
  files: File[];
};
type Restriction = {directory: string; files: Set<string>};
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const slash = (path: string) => path.split(sep).join("/");
const inside = (path: string, directory: string) => path === directory || path.startsWith(directory + "/");
const sourcePattern = /\.(?:[cm]?[jt]sx?|rs|[ch](?:pp|xx)?|cc|m|mm|java|swift)$/;
const scriptPattern = /\.[cm]?[jt]sx?$/;
const ccBy = /\bCC-BY-4\.0\b|creativecommons\.org\/licenses\/by\/4\.0\b/i;
const ccByTitle = /\bAttribution 4\.0 International\b/i;
// Existing attributed WHATWG text in TypeScript's DOM declarations, approved
// by the coordinator. This is a pin of the current component notice, never
// a directory exemption or permission for new CC-BY material. A changed
// notice requires a new review even if the compiler attribution is refreshed.
const existingNotice = {path: "third_party/tsrs/NOTICE", sha256: "1a4f42d83bf205aaf1b474e1a8c133cc5365003a188ba5f257d8aa4741355118"};

function object(value: unknown, keys: string[], at: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join() !== [...keys].sort().join()) {
    throw new Error(`${at}: expected exactly ${keys.join(", ")}`);
  }
  return value as Record<string, unknown>;
}
function text(value: unknown, at: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) throw new Error(`${at}: expected nonempty text`);
  return value;
}
function pathValue(value: unknown, at: string): string {
  const path = text(value, at);
  if (isAbsolute(path) || path.includes("\\") || path.split("/").some(p => !p || p === "." || p === "..")) {
    throw new Error(`${at}: expected a normalized repository-relative path`);
  }
  return path;
}
function file(value: unknown, at: string, spdx = false): File {
  const record = object(value, spdx ? ["path", "sha256", "spdx"] : ["path", "sha256"], at);
  if (spdx && record.spdx !== "CC-BY-4.0") throw new Error(`${at}: only CC-BY-4.0 benchmark inputs are admitted here`);
  const sha256 = text(record.sha256, at);
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`${at}: invalid SHA256`);
  return {path: pathValue(record.path, at), sha256};
}
function decode(value: unknown, at: string): Input[] {
  const manifest = object(value, ["version", "inputs"], at);
  if (manifest.version !== 1 || !Array.isArray(manifest.inputs) || !manifest.inputs.length) throw new Error(`${at}: expected version 1 and nonempty inputs`);
  return manifest.inputs.map((value, index) => {
    const where = `${at} inputs[${index}]`;
    const input = object(value, ["directory", "upstream", "license", "provenance", "files"], where);
    const provenance = object(input.provenance, ["path", "attribution"], where);
    if (!Array.isArray(input.files) || !input.files.length) throw new Error(`${where}: no declared input files`);
    const upstream = text(input.upstream, where);
    if (!/^https:\/\/\S+$/.test(upstream)) throw new Error(`${where}: upstream must identify the pinned source by HTTPS URL`);
    const attribution = text(provenance.attribution, where);
    if (attribution.includes("\n") || !ccBy.test(attribution)) throw new Error(`${where}: attribution must be one line naming CC-BY-4.0`);
    return {directory: pathValue(input.directory, where), upstream,
      license: {...file(input.license, where, true), spdx: "CC-BY-4.0"},
      provenance: {path: pathValue(provenance.path, where), attribution},
      files: input.files.map((value, i) => file(value, `${where} files[${i}]`))};
  });
}

/** The index defines the audited source set, including staged additions. */
export function trackedFiles(root: string): string[] {
  return execFileSync("git", ["ls-files", "-z"], {cwd: root, maxBuffer: 64 << 20, encoding: "utf8"})
    .split("\0").filter(Boolean).sort();
}

export function checkBenchmarkInputs(root: string, paths = trackedFiles(root)): {inputs: number; files: number} {
  root = realpathSync(root);
  const tracked = new Set(paths);
  const contents = new Map<string, string>();
  const read = (path: string) => {
    let value = contents.get(path);
    if (value === undefined) {value = readFileSync(resolve(root, path), "utf8"); contents.set(path, value);}
    return value;
  };
  const restrictions: Restriction[] = [];
  const safeFile = (path: string) => {
    if (!tracked.has(path)) throw new Error(`untracked or missing benchmark input: ${path}`);
    let at = root;
    for (const part of path.split("/")) {
      at = resolve(at, part);
      if (lstatSync(at).isSymbolicLink()) throw new Error(`benchmark input must not traverse a symlink: ${path}`);
    }
    if (!lstatSync(at).isFile()) throw new Error(`benchmark input is not a file: ${path}`);
  };
  for (const manifest of paths.filter(path => basename(path) === INPUT_MANIFEST)) {
    if (!/^benchmarks\/cases\/[^/]+\/input-licenses\.json$/.test(manifest)) throw new Error(`benchmark input manifest outside its case: ${manifest}`);
    const caseDirectory = dirname(manifest);
    for (const input of decode(JSON.parse(read(manifest)), manifest)) {
      if (!inside(input.directory, caseDirectory) || input.directory === caseDirectory) throw new Error(`input directory must be beneath its benchmark case: ${input.directory}`);
      if (restrictions.some(r => inside(r.directory, input.directory) || inside(input.directory, r.directory))) throw new Error(`duplicate or overlapping benchmark input: ${input.directory}`);
      if (!inside(input.license.path, input.directory)) throw new Error(`input licence outside its directory: ${input.license.path}`);
      if (!inside(input.provenance.path, caseDirectory) || inside(input.provenance.path, input.directory)) throw new Error(`provenance must be in the case, outside the input: ${input.provenance.path}`);
      const entries = [input.license, ...input.files];
      const files = new Set(entries.map(entry => entry.path));
      if (files.size !== entries.length) throw new Error(`duplicate benchmark input file: ${input.directory}`);
      for (const entry of entries) {
        if (!inside(entry.path, input.directory)) throw new Error(`declared file outside its input directory: ${entry.path}`);
        safeFile(entry.path);
        if (digest(readFileSync(resolve(root, entry.path))) !== entry.sha256) throw new Error(`benchmark input hash changed: ${entry.path}`);
      }
      for (const path of paths.filter(path => inside(path, input.directory))) {
        if (!files.has(path)) throw new Error(`undeclared benchmark input file: ${path}`);
      }
      const licence = read(input.license.path);
      if (!/Attribution 4\.0 International/i.test(licence) || !/Licensed Material/i.test(licence) || !/Section 3/i.test(licence)) {
        throw new Error(`full CC-BY-4.0 licence text required: ${input.license.path}`);
      }
      safeFile(input.provenance.path);
      const provenance = read(input.provenance.path);
      if (!provenance.split(/\r?\n/).includes(input.provenance.attribution) || !provenance.includes(input.upstream)) {
        throw new Error(`benchmark input attribution or upstream missing: ${input.provenance.path}`);
      }
      restrictions.push({directory: input.directory, files});
    }
  }
  // Do not let omitting the inventory disable the boundary. Notices, package
  // licences and SPDX headers discover CC-BY material independently of it.
  for (const path of paths) {
    if (!existsSync(resolve(root, path))) continue;
    const notice = /^(?:LICEN[CS]E|COPYING|COPYRIGHT|NOTICE)(?:[._-].*)?$/i.test(basename(path));
    const packageFile = basename(path) === "package.json";
    if (!(notice || packageFile || sourcePattern.test(path))) continue;
    const bytes = read(path);
    const hasLicense = notice ? ccBy.test(bytes) || ccByTitle.test(bytes)
      : packageFile ? ccBy.test(String(JSON.parse(bytes).license ?? ""))
      : /^\s*(?:\/\/|\/\*+|\*|#)\s*SPDX-License-Identifier:\s*CC-BY-4\.0\b/im.test(bytes);
    if (path === existingNotice.path) {
      if (digest(readFileSync(resolve(root, path))) !== existingNotice.sha256) throw new Error(`existing attributed CC-BY component notice changed: ${path}`);
      continue;
    }
    if (hasLicense && !restrictions.some(r => inside(path, r.directory))) throw new Error(`undeclared CC-BY-4.0 material (benchmark input only): ${path}`);
  }
  if (!restrictions.length) return {inputs: 0, files: 0};

  const restricted = (absolute: string) => {
    const paths = [absolute];
    if (existsSync(absolute)) paths.push(realpathSync(absolute));
    return paths.map(path => slash(relative(root, path))).find(path => restrictions.some(r => inside(path, r.directory)));
  };
  const reject = (owner: string, target: string, kind: string) => {
    const found = restricted(target);
    if (found) throw new Error(`CC-BY benchmark input cannot ${kind}: ${owner} -> ${found}`);
  };
  const checkLiteral = (path: string, value: string, kind: string) => {
    let candidates: string[];
    if (value.startsWith("file:")) {try {candidates = [fileURLToPath(value)];} catch {return;}}
    else candidates = [resolve(root, dirname(path), value), resolve(root, value)];
    for (const target of candidates) reject(path, target, kind);
  };
  // Native includes/embedding are linkage as well. Refused and currently
  // unbuilt checked-in sources remain in the audit.
  for (const path of paths.filter(path => sourcePattern.test(path) && !scriptPattern.test(path))) {
    const absolute = resolve(root, path);
    if (restrictions.some(r => inside(path, r.directory)) || !existsSync(absolute)) continue;
    reject(path, absolute, "be a source file through a symlink");
    const source = read(path);
    // Recognize direct includes and Rust's usual crate-relative concat.
    for (const match of source.matchAll(/^\s*#\s*(?:include|embed)\s*["<]([^">]+)[">]/gm)) checkLiteral(path, match[1]!, "be included in native code");
    for (const match of source.matchAll(/\binclude(?:_str|_bytes)?!\s*\(\s*("(?:[^"\\]|\\.)*")\s*\)/g)) checkLiteral(path, JSON.parse(match[1]!), "be embedded in native code");
    for (const match of source.matchAll(/\binclude(?:_str|_bytes)?!\s*\(\s*r(#{0,32})"([\s\S]*?)"\1\s*\)/g)) checkLiteral(path, match[2]!, "be embedded in native code");
    let crate = dirname(absolute);
    while (crate.startsWith(root + sep) && !existsSync(resolve(crate, "Cargo.toml"))) crate = dirname(crate);
    for (const match of source.matchAll(/\binclude(?:_str|_bytes)?!\s*\(\s*concat!\s*\(\s*env!\s*\(\s*"CARGO_MANIFEST_DIR"\s*\)\s*,\s*("(?:[^"\\]|\\.)*")\s*\)\s*\)/g)) {
      reject(path, crate + JSON.parse(match[1]!), "be embedded in native code");
    }
    if (!path.startsWith("benchmarks/")) {
      for (const match of source.matchAll(/"([^"\r\n]+)"/g)) checkLiteral(path, match[1]!, "be read outside benchmarks");
    }
  }
  // The installed TypeScript 7 package has a native API, not the old JS
  // compiler API. Its program inventory is the resolver authority: inherited
  // configs, paths, package exports, project references and symlinks all use
  // the pinned compiler, without a second approximation of module resolution.
  const scripts = paths.filter(path => scriptPattern.test(path) && !restrictions.some(r => inside(path, r.directory)) && existsSync(resolve(root, path)));
  const audited = new Set<string>();
  const auditSource = (project: Project, absolute: string) => {
    const path = slash(relative(root, absolute));
    if (audited.has(absolute) || !tracked.has(path) || !scriptPattern.test(path)) return;
    reject(path, absolute, "be a source file through a symlink");
    const source = project.program.getSourceFile(absolute);
    if (!source) throw new Error(`cannot audit captured source: ${path}`);
    const edge = (value: string) => checkLiteral(path, value, "be imported or re-exported");
    const visit = (node: Node): void => {
      if ((isImportDeclaration(node) || isExportDeclaration(node)) && node.moduleSpecifier && isStringLiteralLikeNode(node.moduleSpecifier)) edge(node.moduleSpecifier.text);
      if (isImportEqualsDeclaration(node) && isExternalModuleReference(node.moduleReference) && isStringLiteralLikeNode(node.moduleReference.expression)) edge(node.moduleReference.expression.text);
      if (isCallExpression(node) && node.arguments[0] && isStringLiteralLikeNode(node.arguments[0])) {
        const callee = node.expression;
        if (callee.kind === SyntaxKind.ImportKeyword || isIdentifier(callee) && callee.text === "require"
          || isPropertyAccessExpression(callee) && callee.name.text === "resolve" && isIdentifier(callee.expression) && callee.expression.text === "require") edge(node.arguments[0].text);
      }
      if (!path.startsWith("benchmarks/") && isStringLiteralLikeNode(node)) checkLiteral(path, node.text, "be read outside benchmarks");
      node.forEachChild(visit);
    };
    visit(source);
    for (const reference of [...source.referencedFiles, ...source.typeReferenceDirectives]) edge(reference.fileName);
    audited.add(absolute);
  };
  const inspect = (project: Project, owner: string) => {
    const sources = project.program.getSourceFileNames();
    for (const path of sources) {
      if (!restricted(path)) auditSource(project, path);
    }
    for (const path of sources) reject(owner, path, "enter the resolved compilation graph");
  };
  const api = new API({cwd: root});
  let previous: string | undefined;
  try {
    for (const config of paths.filter(path => /(?:^|\/)tsconfig[^/]*\.json$/.test(path))) {
      const absolute = resolve(root, config);
      const parsed = api.parseConfigFile(absolute);
      for (const path of parsed.fileNames) reject(config, path, "be a compiled project root");
      const snapshot = api.updateSnapshot({openProjects: [absolute], closeProjects: previous ? [previous] : []});
      previous = absolute;
      try {
        const project = snapshot.getProject(absolute);
        if (!project) throw new Error(`cannot audit project graph: ${config}`);
        // parseConfigFile's response omits diagnostics and can be empty after
        // malformed JSON or a missing extends. Empty solution/root sets are
        // legitimate; syntax, options and inheritance errors are not a graph.
        const errors = project.program.getConfigFileParsingDiagnostics().filter(error => ![18002, 18003].includes(error.code));
        if (errors.length) throw new Error(`cannot audit project config ${config}: ${errors.map(error => `TS${error.code}: ${error.text}`).join("; ")}`);
        inspect(project, config);
      } finally {snapshot.dispose(); api.clearSourceFileCache();}
    }
    // Direct-file consumers have no committed config to enumerate. Ask the
    // same resolver for their inferred/default project instead of inventing
    // Node package/conditions or TypeScript paths resolution here.
    let previousFile: string | undefined;
    for (const relativePath of scripts) {
      const path = resolve(root, relativePath);
      if (audited.has(path)) continue;
      const snapshot = api.updateSnapshot({openFiles: [path], closeFiles: previousFile ? [previousFile] : [], closeProjects: previous ? [previous] : []});
      previous = undefined; previousFile = path;
      try {
        const project = snapshot.getDefaultProjectForFile(path);
        if (!project) throw new Error(`cannot audit direct-file graph: ${path}`);
        inspect(project, relativePath);
      } finally {snapshot.dispose(); api.clearSourceFileCache();}
    }
  } finally {api.close();}
  return {inputs: restrictions.length, files: restrictions.reduce((count, r) => count + r.files.size - 1, 0)};
}
