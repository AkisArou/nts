// Vendor the production tsrs crate closure from immutable git objects.
// Re-pin: node compiler/frontend-tsrs/vendor.ts --source <checkout> --rev <commit>
// Verify without an upstream checkout: node compiler/frontend-tsrs/vendor.ts --check
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
for (let at = 0; at < args.length; at++) {
  if (["--source", "--rev", "--out"].includes(args[at])) at++;
  else if (!["--check", "--dry-run"].includes(args[at])) throw new Error(`unknown argument: ${args[at]}`);
}
if (args.includes("--check") && args.includes("--dry-run")) throw new Error("choose --check or --dry-run");
const flag = (name: string) => {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
};
const source = flag("--source");
const requested = flag("--rev");
const target = resolve(flag("--out") ?? join(dirname(fileURLToPath(import.meta.url)), "../../third_party/tsrs"));
const check = args.includes("--check");
const dryRun = args.includes("--dry-run");
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
type File = { bytes: Buffer; mode: number };
type Patch = { id: string; base: string; path: string; sha256: string; rationale: string; remove_when: string };
const adapter = dirname(fileURLToPath(import.meta.url));

function patchesFor(commit: string): Patch[] {
  const path = join(adapter, "patches.json");
  const patches: Patch[] = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
  if (!Array.isArray(patches)) throw new Error("invalid carried tsrs patch registry");
  const ids = new Set<string>();
  for (const patch of patches) {
    if (!patch || !/^[a-z0-9-]+$/.test(patch.id) || ids.has(patch.id) || !/^patches\/[a-z0-9-]+\.patch$/.test(patch.path)
      || !/^[0-9a-f]{64}$/.test(patch.sha256) || !patch.rationale || !patch.remove_when) throw new Error("invalid carried tsrs patch record");
    ids.add(patch.id);
    if (patch.base !== commit) throw new Error(`carried patch ${patch.id} targets ${patch.base}, requested ${commit}; review applicability or removal before re-pinning`);
    if (hash(readFileSync(join(adapter, patch.path))) !== patch.sha256) throw new Error(`carried patch hash mismatch: ${patch.id}`);
  }
  return patches;
}

// Apply exact, reviewed diffs to private copies of immutable upstream objects.
// The upstream checkout is never modified, and a new pin never drops a patch.
function applyPatches(files: Map<string, File>, patches: Patch[]): void {
  if (!patches.length) return;
  const staging = mkdtempSync(join(process.env.TMPDIR ?? join(process.env.HOME!, ".cache"), "nts-tsrs-patches-"));
  try {
    for (const patch of patches) {
      const path = join(adapter, patch.path);
      const diff = readFileSync(path, "utf8");
      const before = [...diff.matchAll(/^--- a\/(.+)$/gm)].map((match) => match[1]);
      const after = [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]);
      if (!before.length || JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`patch must edit existing source files: ${patch.id}`);
      for (const name of before) {
        if (!/^crates\/tsrs_[a-z_]+\/src\/[a-zA-Z0-9_/.]+\.rs$/.test(name) || name.split("/").includes("..")) throw new Error(`invalid patch source: ${name}`);
        const file = files.get(name);
        if (!file) throw new Error(`patch source absent upstream: ${name}`);
        mkdirSync(dirname(join(staging, name)), { recursive: true });
        writeFileSync(join(staging, name), file.bytes);
      }
      execFileSync("git", ["apply", "--check", "--whitespace=error-all", path], { cwd: staging });
      execFileSync("git", ["apply", "--whitespace=error-all", path], { cwd: staging });
      for (const name of before) files.get(name)!.bytes = readFileSync(join(staging, name));
    }
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

function inventory(root: string): string[] {
  return readdirSync(root).sort().flatMap((name) => {
    if (root === target && ["MANIFEST", "Cargo.lock", "target"].includes(name)) return [];
    const path = join(root, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`vendor file is a symlink: ${path}`);
    return stat.isDirectory() ? inventory(path) : [relative(target, path)];
  });
}

function verify(checkPatchRecords = true): string {
  const [commit, ...lines] = readFileSync(join(target, "MANIFEST"), "utf8").trimEnd().split("\n");
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("invalid vendor revision in MANIFEST");
  const expected = new Map<string, string>();
  for (const line of lines) {
    if (!/^[0-9a-f]{64}  [^\r\n]+$/.test(line)) throw new Error("malformed vendor manifest entry");
    const name = line.slice(66);
    if (name.startsWith("/") || name.split("/").includes("..") || expected.has(name)) throw new Error(`invalid manifest path: ${name}`);
    expected.set(name, line.slice(0, 64));
  }
  const actual = inventory(target);
  const errors = actual.filter((name) => !expected.has(name)).map((name) => `unlisted: ${name}`);
  for (const [name, digest] of expected) {
    if (!actual.includes(name)) errors.push(`missing: ${name}`);
    else if (hash(readFileSync(join(target, name))) !== digest) errors.push(`modified: ${name}`);
  }
  const provenance = JSON.parse(readFileSync(join(target, "UPSTREAM.json"), "utf8"));
  if (provenance.commit !== commit) errors.push("UPSTREAM.json and MANIFEST pins differ");
  if (checkPatchRecords && JSON.stringify(provenance.patches ?? []) !== JSON.stringify(patchesFor(commit))) errors.push("UPSTREAM.json and carried patch records differ");
  if (errors.length) throw new Error(errors.join("\n"));
  return commit;
}

if (!source) {
  if (!check || requested || dryRun) throw new Error("use --source <checkout> --rev <commit>, or --check");
  const commit = verify();
  process.stdout.write(`third_party/tsrs: ${commit}, ${inventory(target).length} files verified\n`);
  if (!flag("--out")) execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "../../tooling/licenses/licenses.ts"), "--check"], { stdio: "inherit" });
  if (!flag("--out")) execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "roles.ts"), "--check"], { stdio: "inherit" });
  if (!flag("--out")) execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "names.ts"), "--check"], { stdio: "inherit" });
} else {
  if (!requested) throw new Error("--source needs --rev <commit>; no floating pin is inferred");
  const git = (...argv: string[]) => execFileSync("git", ["-C", source, ...argv], { maxBuffer: 64 << 20 });
  const commit = git("rev-parse", "--verify", `${requested}^{commit}`).toString().trim();
  const patches = patchesFor(commit);
  const read = (path: string) => git("show", `${commit}:${path}`);
  const manifest = read("Cargo.toml").toString();
  const section = (name: string) => {
    const start = manifest.indexOf(`[${name}]`);
    if (start < 0) throw new Error(`missing upstream section [${name}]`);
    const end = manifest.indexOf("\n[", start + 1);
    return manifest.slice(start, end < 0 ? undefined : end).trimEnd();
  };
  const paths = new Map([...section("workspace.dependencies").matchAll(/^(tsrs_\w+)\s*=\s*\{\s*path\s*=\s*"([^"]+)"/gm)].map((match) => [match[1], match[2]]));
  const crates = new Set<string>();
  const pending = ["tsrs_compiler"];
  while (pending.length) {
    const name = pending.pop()!;
    if (crates.has(name)) continue;
    const path = paths.get(name);
    if (!path || !/^crates\/tsrs_\w+$/.test(path)) throw new Error(`unmapped upstream crate: ${name}`);
    crates.add(name);
    let production = false;
    for (const line of read(`${path}/Cargo.toml`).toString().split("\n")) {
      if (line.startsWith("[")) production = /^\[(?:dependencies|target\..+\.dependencies)\]$/.test(line);
      const dependency = production && /^(tsrs_\w+)(?:\.workspace)?\s*=/.exec(line);
      if (dependency) pending.push(dependency[1]);
    }
  }
  const files = new Map<string, File>();
  const roots = [...crates].sort().map((name) => paths.get(name)!);
  const entries = git("ls-tree", "-rz", "--full-tree", commit, "--", ...roots, "LICENSE", "NOTICE").toString().split("\0").filter(Boolean);
  for (const entry of entries) {
    const match = /^(100644|100755) blob [0-9a-f]+\t(.+)$/.exec(entry);
    if (!match || /[\r\n]/.test(match[2])) throw new Error(`unsupported upstream file: ${entry}`);
    files.set(match[2], { bytes: read(match[2]), mode: match[1] === "100755" ? 0o755 : 0o644 });
  }
  const generated = (name: string, text: string) => files.set(name, { bytes: Buffer.from(text), mode: 0o644 });
  const sections = ["workspace.package", "workspace.metadata.typescript", "workspace.dependencies", "workspace.lints.rust", "workspace.lints.clippy"];
  applyPatches(files, patches);
  generated("Cargo.toml", `# Generated from oxc-project/tsrs ${commit}; ${patches.length ? "local patches disclosed in UPSTREAM.json" : "crate sources are unmodified"}.\n[workspace]\nresolver = "3"\nmembers = ["crates/*"]\n\n${sections.map(section).join("\n\n")}\n`);
  generated(".gitignore", "/target/\n/Cargo.lock\n");
  const version = /^version\s*=\s*"([^"]+)"/m.exec(section("workspace.package"))![1];
  const tsCommit = /^commit\s*=\s*"([^"]+)"/m.exec(section("workspace.metadata.typescript"))![1];
  generated("UPSTREAM.json", `${JSON.stringify({ repository: "https://github.com/oxc-project/tsrs", commit, version, typescript_commit: tsCommit, crates: [...crates].sort(), ...(patches.length ? { patches } : {}) }, null, 2)}\n`);
  generated("UPSTREAM.md", `# tsrs, vendored\n\nThe production dependency closure of tsrs_compiler from\n[oxc-project/tsrs](https://github.com/oxc-project/tsrs) at\n\`${commit}\` (version ${version}), unmodified, with LICENSE and NOTICE.\nThe generated root Cargo.toml retains upstream package metadata, dependencies\nand lints, over these crates only. nts excludes this standalone workspace\nand consumes its crates by path. UPSTREAM.json records the exact closure.\n\nRe-pin in one command:\n\n    node compiler/frontend-tsrs/vendor.ts --source <checkout> --rev <commit>\n\nThe tool reads immutable git objects; it does not change the source checkout.\nBefore replacing an existing copy it verifies MANIFEST and refuses local edits.\n\n    node compiler/frontend-tsrs/vendor.ts --check\n\nThe gate checks the SHA-256 manifest, including file inventory, without an\nupstream checkout. --source <checkout> --rev <commit> --check additionally\ncompares the copy with the exact upstream objects. Upstream source is never\nformatted or edited as part of an nts change.\n`);
  if (patches.length) {
    const text = files.get("UPSTREAM.md")!;
    text.bytes = Buffer.from(text.bytes.toString()
      .replace("unmodified, with LICENSE and NOTICE", "with the explicit local patches below, LICENSE and NOTICE")
      .replace("compares the copy with the exact upstream objects. Upstream source is never\nformatted or edited as part of an nts change.", "compares the copy with the exact upstream objects plus these reviewed patches.\nA new revision is refused until patch applicability or removal is reviewed.")
      + "\nLocal patches (base revision and exact SHA-256 are in UPSTREAM.json):\n\n"
      + patches.map((patch) => `- ${patch.id}: ${patch.sha256}. ${patch.rationale} Remove when: ${patch.remove_when}`).join("\n") + "\n");
  }
  const ordered = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const text = `${commit}\n${ordered.map(([name, file]) => `${hash(file.bytes)}  ${name}`).join("\n")}\n`;
  if (check) {
    if (verify() !== commit || readFileSync(join(target, "MANIFEST"), "utf8") !== text) throw new Error("vendor copy differs from requested upstream revision");
  } else if (!dryRun) {
    // Verify every existing file and its provenance before replacement. The
    // new external patch registry is checked against the newly generated copy.
    if (existsSync(target)) verify(false);
    const staging = `${target}.staging-${process.pid}`;
    const backup = `${target}.previous-${process.pid}`;
    if (existsSync(staging) || existsSync(backup)) throw new Error("vendor staging path already exists");
    try {
      mkdirSync(staging, { recursive: true });
      for (const [name, file] of ordered) {
        const path = join(staging, name);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, file.bytes);
        chmodSync(path, file.mode);
      }
      writeFileSync(join(staging, "MANIFEST"), text);
      if (existsSync(target)) renameSync(target, backup);
      try { renameSync(staging, target); }
      catch (error) { if (existsSync(backup)) renameSync(backup, target); throw error; }
      if (existsSync(backup)) rmSync(backup, { recursive: true });
    } finally {
      if (existsSync(staging)) rmSync(staging, { recursive: true });
    }
  }
  const lines = ordered.filter(([name]) => name.endsWith(".rs")).reduce((sum, [, file]) => sum + file.bytes.toString().split("\n").length - 1, 0);
  process.stdout.write(`${JSON.stringify({ commit, version, typescript_commit: tsCommit, crates: crates.size, files: files.size, rust_lines: lines, manifest_sha256: hash(text), checked: check, dry_run: dryRun })}\n`);
  // Keep the safe named slots derived from the exact new native visitor.
  // The normal gate's --check regenerates both files in a scratch directory.
  if (!flag("--out") && !dryRun) execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "roles.ts"), ...(check ? ["--check"] : [])], { stdio: "inherit" });
  if (!flag("--out") && !dryRun) execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "names.ts"), ...(check ? ["--check"] : [])], { stdio: "inherit" });
}
