// Generate attributions from the compiler's locked closure plus the declared
// vendored-data inputs; check Cargo.lock without network access, Cargo, or a
// populated registry cache.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../..");
const destination = join(root, "licenses");
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const args = process.argv.slice(2);
if (args.length !== 1 || !["--update", "--check"].includes(args[0])) throw new Error("use --update or --check");
type Package = { name: string; version: string; source?: string; checksum?: string; dependencies: string[] };
type Attribution = { name: string; version: string; source: string; checksum: string; license: string; repository: string | null; texts: { upstream: string; sha256: string }[] };
type Text = Attribution["texts"][number];
type Vendored = { directory: string; packages: { name: string; version: string; manifest: string }[]; texts: Text[] };
type VendoredData = { name: string; license: string; texts: Text[] };
// Vendored data inputs are not crates, so Cargo.lock cannot see them; they
// are declared here by hand, each with the repository path of its license
// file. Verification fails when a declared file is missing or unrecorded,
// so vendoring data without its license stops at --check, not at release.
const declaredData: { name: string; license: string }[] = [
  { name: "Unicode Character Database 17.0.0", license: "compiler/unicode/data/LICENSE" },
];
const lock = readFileSync(join(root, "Cargo.lock"), "utf8");
const packages: Package[] = lock.split("[[package]]").slice(1).map((entry) => {
  const field = (name: string) => new RegExp(`^${name} = "([^"]+)"$`, "m").exec(entry)?.[1];
  const name = field("name"), version = field("version");
  if (!name || !version) throw new Error("unrecognized Cargo.lock package");
  const dependencies = /\ndependencies = \[([\s\S]*?)\]/.exec(entry)?.[1] ?? "";
  return { name, version, source: field("source"), checksum: field("checksum"),
    dependencies: [...dependencies.matchAll(/"([^"]+)"/g)].map((m) => m[1]) };
});
const key = (pkg: { name: string; version: string }) => `${pkg.name}@${pkg.version}`;
const visited = new Map<string, Package>();
function visit(pkg: Package) {
  if (visited.has(key(pkg))) return;
  visited.set(key(pkg), pkg);
  for (const dependency of pkg.dependencies) {
    const [name, version] = dependency.split(" ");
    const matches = packages.filter((p) => p.name === name && (!version || p.version === version));
    if (matches.length !== 1) throw new Error(`ambiguous lock dependency: ${dependency}`);
    visit(matches[0]);
  }
}
const adapter = packages.find((pkg) => pkg.name === "nts-frontend-tsrs");
if (!adapter) throw new Error("native adapter absent from Cargo.lock");
const cli = packages.find((pkg) => pkg.name === "nts-cli");
if (!cli) throw new Error("compiler CLI absent from Cargo.lock");
visit(adapter);
const adapterKeys = new Set(visited.keys());
visit(cli);
const registry = [...visited.values()].filter((pkg) => pkg.source).sort((a, b) => key(a).localeCompare(key(b), "en"));
const inventoryPath = join(destination, "packages.json");
const vendorPath = join(destination, "vendor-projects.json");
const dataPath = join(destination, "vendored-data.json");
const ownPackages = new Set<string>();
const packageName = (path: string) => {
  const manifest = readFileSync(path, "utf8");
  const start = manifest.indexOf("[package]");
  const end = manifest.indexOf("\n[", start + 1);
  const name = /^name\s*=\s*"([^"]+)"/m.exec(manifest.slice(start, end < 0 ? undefined : end))?.[1];
  if (start < 0 || !name) throw new Error(`package name absent: ${path}`);
  return name;
};
const members = /^members\s*=\s*\[([\s\S]*?)\]/m.exec(readFileSync(join(root, "Cargo.toml"), "utf8"))?.[1];
if (!members) throw new Error("workspace members absent");
const memberDirs: string[] = [];
for (const [, member] of members.matchAll(/"([^"]+)"/g)) {
  if (/[?*\[\]]/.test(member)) throw new Error(`explicit workspace members required: ${member}`);
  memberDirs.push(member);
  ownPackages.add(packageName(join(root, member, "Cargo.toml")));
}
// The vendored-data convention: an owned crate that vendors data keeps the
// data's license at `<crate>/data/LICENSE`. Discovering those paths and
// comparing with the declared list means a new vendored input fails --check
// until it is declared -- the declaration cannot be forgotten. Upstream
// third_party crates are not workspace members and stay with the vendored
// projects above.
const discoverDataLicenses = (): string[] =>
  memberDirs.map((member) => `${member}/data/LICENSE`).filter((path) => existsSync(join(root, path)));
const vendorPackages = [...visited.values()].filter((p) => !p.source && !ownPackages.has(p.name));
const licenceNames = (path: string) => readdirSync(path).filter((name) => /^(?:LICEN[CS]E|COPYING|COPYRIGHT|NOTICE|UNLICENSE)/i.test(name)).sort();

if (args[0] === "--update") {
  const metadata = JSON.parse(execFileSync("cargo", ["metadata", "--locked", "--offline", "--format-version", "1"], { cwd: root, maxBuffer: 32 << 20 }).toString());
  const inventory: Attribution[] = [];
  mkdirSync(join(destination, "texts"), { recursive: true });
  const copy = (source: string, names: string[]): Text[] => [...new Set(names)].sort().map((name) => {
    const bytes = readFileSync(join(source, name));
    const digest = sha256(bytes);
    writeFileSync(join(destination, "texts", `${digest}.txt`), bytes);
    return { upstream: name, sha256: digest };
  });
  for (const pkg of registry) {
    const resolved = metadata.packages.find((p: Package) => key(p) === key(pkg) && p.source === pkg.source);
    if (!resolved?.license) throw new Error(`missing resolved licence: ${key(pkg)}`);
    const upstream = dirname(resolved.manifest_path);
    const names = licenceNames(upstream);
    if (resolved.license_file) names.push(relative(upstream, resolved.license_file));
    const texts = copy(upstream, names);
    if (!texts.length) throw new Error(`licence texts not packaged: ${key(pkg)}`);
    inventory.push({ name: pkg.name, version: pkg.version, source: pkg.source!, checksum: pkg.checksum!,
      license: resolved.license, repository: resolved.repository, texts });
  }
  const groups = new Map<string, Vendored>();
  for (const pkg of vendorPackages) {
    const resolved = metadata.packages.find((p: Package) => key(p) === key(pkg) && !p.source);
    if (!resolved) throw new Error(`vendored package absent from metadata: ${key(pkg)}`);
    const parts = relative(root, resolved.manifest_path).split(sep);
    if (parts[0] !== "third_party" || !parts[1]) throw new Error(`non-workspace package outside third_party: ${key(pkg)}`);
    const path = parts.slice(0, 2).join("/");
    let project = groups.get(path);
    if (!project) {
      const source = join(root, path);
      project = { directory: path, packages: [], texts: copy(source, licenceNames(source)) };
      if (!project.texts.length) throw new Error(`vendored licence texts absent: ${path}`);
      groups.set(path, project);
    }
    project.packages.push({ name: pkg.name, version: pkg.version, manifest: relative(join(root, path), resolved.manifest_path).split(sep).join("/") });
  }
  const projects = [...groups.values()].sort((a, b) => a.directory.localeCompare(b.directory, "en"));
  for (const project of projects) project.packages.sort((a, b) => key(a).localeCompare(key(b), "en"));
  const data: VendoredData[] = declaredData.map(({ name, license }) => ({
    name,
    license,
    texts: copy(root, [license]),
  }));
  writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
  writeFileSync(vendorPath, `${JSON.stringify(projects, null, 2)}\n`);
  writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`);
  const links = (texts: Text[]) => texts.map((t) => `[${t.upstream}](texts/${t.sha256}.txt)`).join(", ");
  writeFileSync(join(destination, "README.md"), `# Compiler dependency attributions\n\nGenerated from Cargo.lock by \`node tooling/licenses/licenses.ts --update\`.\nRoots: the release CLI and native frontend (until it becomes unconditional).\nThis conservative locked closure covers all platform/feature dependency paths.\nThe gate checks completeness and every full licence/notice text offline.\nShip this directory with compiler binary distributions. Ship notices for\nlinked runtime components separately with built programs.\n\n## Vendored code\n\nFull texts are copied here; a distribution needs no source checkout.\n\n| Project | Locked crates | Full texts and notices |\n| --- | --- | --- |\n${projects.map((p) => `| ${p.directory} | ${p.packages.length} | ${links(p.texts)} |`).join("\n")}\n\n## Vendored data\n\nData files the compiler carries derived tables from, declared in\n\`tooling/licenses/licenses.ts\` because Cargo.lock cannot see them.\n\n| Input | Licence file | Full text |\n| --- | --- | --- |\n${data.map((d) => `| ${d.name} | ${d.license} | ${links(d.texts)} |`).join("\n")}\n\n## Registry dependencies\n\n| Package | Version | Licence | Texts and notices |\n| --- | --- | --- | --- |\n${inventory.map((p) => `| ${p.name} | ${p.version} | ${p.license} | ${links(p.texts)} |`).join("\n")}\n`);
  const used = new Set([...inventory, ...projects, ...data].flatMap((p) => p.texts.map((t) => `${t.sha256}.txt`)));
  for (const name of readdirSync(join(destination, "texts"))) if (!used.has(name)) rmSync(join(destination, "texts", name));
}

const inventory: Attribution[] = JSON.parse(readFileSync(inventoryPath, "utf8"));
const projects: Vendored[] = JSON.parse(readFileSync(vendorPath, "utf8"));
const data: VendoredData[] = JSON.parse(readFileSync(dataPath, "utf8"));
const loadText = (digest: string) => readFileSync(join(destination, "texts", `${digest}.txt`));
const loadLicense = (path: string) => readFileSync(join(root, path));
function verify(records: Attribution[], vendors: Vendored[], vendoredData: VendoredData[], discovered: string[] = discoverDataLicenses(), readText = loadText, readLicense = loadLicense): Set<string> {
  const byKey = new Map(records.map((p) => [key(p), p]));
  const expected = new Set(registry.map(key));
  if (byKey.size !== records.length) throw new Error("duplicate compiler attribution");
  for (const name of byKey.keys()) if (!expected.has(name)) throw new Error(`unlisted compiler attribution: ${name}`);
  const texts = new Set<string>();
  const text = (entry: Text) => {
    if (!/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error("invalid attribution text digest");
    texts.add(`${entry.sha256}.txt`);
    if (sha256(readText(entry.sha256)) !== entry.sha256) throw new Error(`modified licence text: ${entry.sha256}`);
  };
  for (const pkg of registry) {
    const attribution = byKey.get(key(pkg));
    if (!attribution || attribution.source !== pkg.source || attribution.checksum !== pkg.checksum || !attribution.license || !attribution.texts.length) {
      throw new Error(`compiler attribution missing or stale: ${key(pkg)}; run licenses.ts --update`);
    }
    for (const entry of attribution.texts) text(entry);
  }
  const seenPackages = new Set<string>(), seenProjects = new Set<string>();
  const expectedVendor = new Set(vendorPackages.map(key));
  for (const project of vendors) {
    if (!/^third_party\/[a-zA-Z0-9_-]+$/.test(project.directory) || seenProjects.has(project.directory)) throw new Error("invalid/duplicate vendored project");
    seenProjects.add(project.directory);
    for (const pkg of project.packages) {
      if (!expectedVendor.has(key(pkg)) || seenPackages.has(key(pkg))) throw new Error(`invalid/duplicate vendored attribution: ${key(pkg)}`);
      if (!pkg.manifest || pkg.manifest.startsWith("/") || pkg.manifest.split("/").includes("..") || packageName(join(root, project.directory, pkg.manifest)) !== pkg.name) throw new Error(`vendored package belongs to another project: ${key(pkg)}`);
      seenPackages.add(key(pkg));
    }
    const source = join(root, project.directory);
    assert.deepEqual(project.texts.map((t) => t.upstream).sort(), licenceNames(source), `missing vendored licence/NOTICE: ${project.directory}`);
    for (const entry of project.texts) {
      text(entry);
      if (sha256(readFileSync(join(source, entry.upstream))) !== entry.sha256) throw new Error(`vendored licence/notice changed: ${project.directory}/${entry.upstream}`);
    }
  }
  for (const pkg of expectedVendor) if (!seenPackages.has(pkg)) throw new Error(`vendored attribution missing: ${pkg}`);
  const dataByName = new Map(vendoredData.map((d) => [d.name, d]));
  if (dataByName.size !== vendoredData.length) throw new Error("duplicate vendored data attribution");
  for (const declared of declaredData) {
    const record = dataByName.get(declared.name);
    if (!record || record.license !== declared.license || record.texts.length !== 1) {
      throw new Error(`vendored data attribution missing or stale: ${declared.name}; run licenses.ts --update`);
    }
    let bytes: Buffer;
    try {
      bytes = readLicense(declared.license);
    } catch {
      throw new Error(`vendored data licence missing: ${declared.license}`);
    }
    if (sha256(bytes) !== record.texts[0].sha256 || record.texts[0].upstream !== declared.license) {
      throw new Error(`vendored data licence changed: ${declared.license}; run licenses.ts --update`);
    }
    text(record.texts[0]);
  }
  for (const name of dataByName.keys()) {
    if (!declaredData.some((d) => d.name === name)) throw new Error(`undeclared vendored data attribution: ${name}`);
  }
  for (const path of discovered) {
    if (!declaredData.some((d) => d.license === path)) {
      throw new Error(`undeclared vendored data licence: ${path}; declare it in licenses.ts and run licenses.ts --update`);
    }
  }
  return texts;
}
const textFiles = verify(inventory, projects, data);
if (readdirSync(join(destination, "texts")).some((name) => !textFiles.has(name))) throw new Error("unlisted attribution text; remove texts no longer referenced after regeneration");
if (args[0] === "--check") {
  // Negative controls operate on owned copies, never edits to checked files.
  const missing = registry.find((p) => !adapterKeys.has(key(p))) ?? registry[0];
  assert.ok(missing, "compiler has registry dependencies");
  assert.throws(() => verify(inventory.filter((p) => key(p) !== key(missing)), projects, data), (error) => error instanceof Error && error.message.includes(`missing or stale: ${key(missing)}`));
  const noNotice = structuredClone(projects);
  const tsrs = noNotice.find((p) => p.directory === "third_party/tsrs");
  assert.ok(tsrs?.texts.some((t) => t.upstream === "NOTICE"));
  tsrs.texts = tsrs.texts.filter((t) => t.upstream !== "NOTICE");
  assert.throws(() => verify(inventory, noNotice, data), /missing vendored licence\/NOTICE/);
  const corrupt = inventory[0].texts[0].sha256;
  assert.throws(() => verify(inventory, projects, data, discoverDataLicenses(), (digest) => digest === corrupt ? Buffer.concat([loadText(digest), Buffer.from("corrupt")]) : loadText(digest)), /modified licence text/);
  assert.ok(declaredData.length, "vendored data inputs are declared");
  assert.throws(() => verify(inventory, projects, data.filter((d) => d.name !== declaredData[0].name)), /vendored data attribution missing or stale/);
  assert.throws(
    () => verify(inventory, projects, data, discoverDataLicenses(), loadText, (path) => {
      if (path === declaredData[0].license) throw new Error("ENOENT (injected)");
      return loadLicense(path);
    }),
    /vendored data licence missing/,
  );
  assert.throws(
    () => verify(inventory, projects, data, [...discoverDataLicenses(), "compiler/core/data/LICENSE"]),
    /undeclared vendored data licence: compiler\/core\/data\/LICENSE/,
  );
}
process.stdout.write(`compiler attributions: ${registry.length} registry packages, ${vendorPackages.length} vendored crates in ${projects.length} projects, ${data.length} vendored data inputs, ${textFiles.size} verbatim texts verified\n`);
