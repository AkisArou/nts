// Generate attributions from the compiler's locked closure plus the declared
// vendored-data inputs; check Cargo.lock without network access, Cargo, or a
// populated registry cache.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBenchmarkInputs } from "./benchmark-inputs.ts";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../..");
const destination = join(root, "licenses");
const nodeRecipePath = "build/node-deps/recipes.json";
const nodeRecipe = JSON.parse(readFileSync(join(root, nodeRecipePath), "utf8")) as { node: string; notices: Record<string, string> };
// Compiler and program attributions read the same resolved notice bytes.
function licenseInput(path: string): Buffer {
  const marker = "#notice/";
  const at = path.indexOf(marker);
  if (at < 0) return readFileSync(path);
  const recipe = JSON.parse(readFileSync(path.slice(0, at), "utf8"));
  const text = recipe.notices[path.slice(at + marker.length)];
  if (typeof text !== "string") throw new Error(`missing bundled dependency notice: ${path}`);
  return Buffer.from(text);
}
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const args = process.argv.slice(2);
if (args.length !== 1 || !["--update", "--check"].includes(args[0])) throw new Error("use --update or --check");
const benchmarkInputs = checkBenchmarkInputs(root);
type Package = { name: string; version: string; source?: string; checksum?: string; dependencies: string[] };
type Attribution = { name: string; version: string; source: string; checksum: string; license: string; repository: string | null; texts: { upstream: string; sha256: string }[] };
type Text = Attribution["texts"][number];
type Vendored = { directory: string; packages: { name: string; version: string; manifest: string }[]; texts: Text[] };
type VendoredData = { name: string; license: string; texts: Text[] };
type Component = { directory: string; license: string; program_license: string; texts: Text[] };
const declaredComponents = [
  { directory: "runtime/c/ffc", license: "Apache-2.0 OR MIT OR BSL-1.0", program_license: "BSL-1.0", licenses: ["LICENSE-APACHE", "LICENSE-MIT", "LICENSE-BOOST"] },
  { directory: "runtime/c/quickjs", license: "MIT", program_license: "MIT", licenses: ["LICENSE"] },
  { directory: "runtime/c/zmij", license: "MIT", program_license: "MIT", licenses: ["LICENSE"] },
];
// Vendored data inputs are not crates, so Cargo.lock cannot see them; they
// are declared here by hand, each with the repository path of its license
// file. Verification fails when a declared file is missing or unrecorded,
// so vendoring data without its license stops at --check, not at release.
const declaredData: { name: string; license: string }[] = [
  { name: "Unicode Character Database 17.0.0", license: "compiler/unicode/data/LICENSE" },
  ...Object.keys(nodeRecipe.notices).sort().map(name => ({
    name: `Node ${nodeRecipe.node} bundled ${name} sources`, license: `${nodeRecipePath}#notice/${name}`,
  })),
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
const componentsPath = join(destination, "components.json");
const ownPackages = new Set<string>();
const ownLicense = "Apache-2.0 WITH LLVM-exception";
const workspaceManifest = readFileSync(join(root, "Cargo.toml"), "utf8");
const workspacePackage = workspaceManifest.split("[workspace.package]")[1]?.split("\n[")[0] ?? "";
const workspaceLicense = /^license\s*=\s*"([^"]+)"/m.exec(workspacePackage)?.[1];
if (workspaceLicense !== ownLicense) throw new Error(`nts workspace licence must be ${ownLicense}`);
// Workspace-owned code uses the LLVM exception and is excluded from the
// third-party inventory. This does not change any dependency's licence or
// notice obligations. Keep --check offline, without invoking Cargo.
const packageName = (path: string, manifest = readFileSync(path, "utf8"), owned = false) => {
  const start = manifest.indexOf("[package]");
  const end = manifest.indexOf("\n[", start + 1);
  const pkg = manifest.slice(start, end < 0 ? undefined : end);
  const name = /^name\s*=\s*"([^"]+)"/m.exec(pkg)?.[1];
  if (start < 0 || !name) throw new Error(`package name absent: ${path}`);
  const explicit = /^license\s*=\s*"([^"]+)"/m.exec(pkg)?.[1];
  const inherited = /^license\.workspace\s*=\s*true\s*$/m.test(pkg)
    || /^license\s*=\s*\{\s*workspace\s*=\s*true\s*\}\s*$/m.test(pkg);
  if (owned && (explicit ?? (inherited ? workspaceLicense : undefined)) !== ownLicense) {
    throw new Error(`own package licence must be ${ownLicense}: ${path}`);
  }
  return name;
};
const members = /^members\s*=\s*\[([\s\S]*?)\]/m.exec(workspaceManifest)?.[1];
if (!members) throw new Error("workspace members absent");
const memberDirs: string[] = [];
for (const [, member] of members.matchAll(/"([^"]+)"/g)) {
  if (/[?*\[\]]/.test(member)) throw new Error(`explicit workspace members required: ${member}`);
  memberDirs.push(member);
  ownPackages.add(packageName(join(root, member, "Cargo.toml"), undefined, true));
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
    const bytes = licenseInput(join(source, name));
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
  const components: Component[] = declaredComponents.map(({ directory, license, program_license, licenses }) => ({
    directory, license, program_license, texts: copy(join(root, directory), licenses),
  }));
  writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
  writeFileSync(vendorPath, `${JSON.stringify(projects, null, 2)}\n`);
  writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`);
  writeFileSync(componentsPath, `${JSON.stringify(components, null, 2)}\n`);
  const links = (texts: Text[]) => texts.map((t) => `[${t.upstream}](texts/${t.sha256}.txt)`).join(", ");
  writeFileSync(join(destination, "README.md"), `# Compiler dependency attributions\n\nGenerated from Cargo.lock by \`node tooling/licenses/licenses.ts --update\`.\nRoots: the release CLI and native frontend (until it becomes unconditional).\nThis conservative locked closure covers all platform/feature dependency paths.\nThe gate checks completeness and every full licence/notice text offline.\nShip this directory with compiler binary distributions. The nts runtime\nneeds no notice in compiled programs under its Apache-2.0 WITH LLVM-exception\nlicence. Third-party components linked into a program retain their own notices.\n\n## Vendored code\n\nFull texts are copied here; a distribution needs no source checkout.\n\n| Project | Locked crates | Full texts and notices |\n| --- | --- | --- |\n${projects.map((p) => `| ${p.directory} | ${p.packages.length} | ${links(p.texts)} |`).join("\n")}\n\n## Vendored data\n\nData files the compiler carries derived tables from, declared in\n\`tooling/licenses/licenses.ts\` because Cargo.lock cannot see them.\n\n| Input | Licence file | Full text |\n| --- | --- | --- |\n${data.map((d) => `| ${d.name} | ${d.license} | ${links(d.texts)} |`).join("\n")}\n\n## Registry dependencies\n\n| Package | Version | Licence | Texts and notices |\n| --- | --- | --- | --- |\n${inventory.map((p) => `| ${p.name} | ${p.version} | ${p.license} | ${links(p.texts)} |`).join("\n")}\n`);
  const readme = join(destination, "README.md");
  const componentSection = `## Embedded C components\n\nThe compiler embeds these sources. FFC is used under BSL-1.0 in compiled\nprograms, which need no FFC notice; its source header retains the full licence.\nAll upstream licence alternatives remain in the compiler distribution.\n\n| Component | Upstream licence | Used in programs | Full texts |\n| --- | --- | --- | --- |\n${components.map(c => `| ${c.directory} | ${c.license} | ${c.program_license} | ${links(c.texts)} |`).join("\n")}\n\n`;
  writeFileSync(readme, readFileSync(readme, "utf8").replace("## Registry dependencies\n", `${componentSection}## Registry dependencies\n`));
  const used = new Set([...inventory, ...projects, ...data, ...components].flatMap((p) => p.texts.map((t) => `${t.sha256}.txt`)));
  for (const name of readdirSync(join(destination, "texts"))) if (!used.has(name)) rmSync(join(destination, "texts", name));
}

const inventory: Attribution[] = JSON.parse(readFileSync(inventoryPath, "utf8"));
const projects: Vendored[] = JSON.parse(readFileSync(vendorPath, "utf8"));
const data: VendoredData[] = JSON.parse(readFileSync(dataPath, "utf8"));
const components: Component[] = JSON.parse(readFileSync(componentsPath, "utf8"));
const loadText = (digest: string) => readFileSync(join(destination, "texts", `${digest}.txt`));
const loadLicense = (path: string) => licenseInput(join(root, path));
const discoverComponents = () => readdirSync(join(root, "runtime/c"), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && licenceNames(join(root, "runtime/c", entry.name)).length)
  .map(entry => `runtime/c/${entry.name}`);
function verifyComponents(records: Component[], readText = loadText, readLicense = loadLicense, discovered = discoverComponents()): Set<string> {
  const byDirectory = new Map(records.map(record => [record.directory, record]));
  if (byDirectory.size !== records.length) throw new Error("duplicate embedded component attribution");
  const texts = new Set<string>();
  for (const declared of declaredComponents) {
    const record = byDirectory.get(declared.directory);
    if (!record || record.license !== declared.license || record.program_license !== declared.program_license) {
      throw new Error(`embedded component attribution missing or stale: ${declared.directory}`);
    }
    assert.deepEqual(record.texts.map(text => text.upstream).sort(), [...declared.licenses].sort(), `embedded component licence set changed: ${declared.directory}`);
    assert.deepEqual(licenceNames(join(root, declared.directory)), [...declared.licenses].sort(), `unrecorded embedded component licence: ${declared.directory}`);
    for (const entry of record.texts) {
      const path = `${declared.directory}/${entry.upstream}`;
      let source: Buffer;
      try { source = readLicense(path); }
      catch { throw new Error(`embedded component licence missing: ${path}`); }
      if (!/^[a-f0-9]{64}$/.test(entry.sha256) || sha256(source) !== entry.sha256) throw new Error(`embedded component licence changed: ${path}`);
      if (sha256(readText(entry.sha256)) !== entry.sha256) throw new Error(`modified embedded component licence text: ${path}`);
      texts.add(`${entry.sha256}.txt`);
    }
  }
  for (const directory of byDirectory.keys()) {
    if (!declaredComponents.some(component => component.directory === directory)) throw new Error(`undeclared embedded component attribution: ${directory}`);
  }
  for (const directory of discovered) {
    if (!declaredComponents.some(component => component.directory === directory)) throw new Error(`undeclared embedded component: ${directory}`);
  }
  return texts;
}
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
for (const text of verifyComponents(components)) textFiles.add(text);
if (readdirSync(join(destination, "texts")).some((name) => !textFiles.has(name))) throw new Error("unlisted attribution text; remove texts no longer referenced after regeneration");
if (args[0] === "--check") {
  // Negative controls operate on owned copies, never edits to checked files.
  assert.equal(packageName("owned licence control", '[package]\nname = "nts-control"\nlicense.workspace = true\n', true), "nts-control");
  assert.throws(() => packageName("owned licence control", '[package]\nname = "nts-control"\nlicense = "Apache-2.0"\n', true), /own package licence must be Apache-2.0 WITH LLVM-exception/);
  assert.equal(packageName("upstream licence control", '[package]\nname = "upstream-control"\nlicense = "MIT"\n'), "upstream-control");
  assert.throws(() => verifyComponents(components.slice(1)), /embedded component attribution missing or stale/);
  const wrongChoice = structuredClone(components);
  wrongChoice[0].program_license = "MIT";
  assert.throws(() => verifyComponents(wrongChoice), /embedded component attribution missing or stale/);
  assert.throws(() => verifyComponents(components, loadText, () => { throw new Error("injected ENOENT"); }), /embedded component licence missing/);
  assert.throws(() => verifyComponents(components, loadText, loadLicense, [...discoverComponents(), "runtime/c/unrecorded-control"]), /undeclared embedded component: runtime\/c\/unrecorded-control/);
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
process.stdout.write(`compiler attributions: ${registry.length} registry packages, ${vendorPackages.length} vendored crates in ${projects.length} projects, ${data.length} vendored data inputs, ${components.length} embedded components, ${textFiles.size} verbatim texts verified\n`);
process.stdout.write(`CC-BY benchmark inputs: ${benchmarkInputs.inputs} inventories, ${benchmarkInputs.files} data files; no compilation or product reach\n`);
