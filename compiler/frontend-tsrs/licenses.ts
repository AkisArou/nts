// Generate attributions from the resolved native graph; check against Cargo.lock
// without network access, Cargo, or a populated registry cache.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../..");
const destination = join(directory, "licenses");
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const args = process.argv.slice(2);
if (args.length !== 1 || !["--update", "--check"].includes(args[0])) throw new Error("use --update or --check");
type Package = { name: string; version: string; source?: string; checksum?: string; dependencies: string[] };
type Attribution = { name: string; version: string; source: string; checksum: string; license: string; repository: string | null; texts: { upstream: string; sha256: string }[] };
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
visit(adapter);
const nativeRegistry = [...visited.values()].filter((pkg) => pkg.source).sort((a, b) => key(a).localeCompare(key(b), "en"));
const inventoryPath = join(destination, "packages.json");

if (args[0] === "--update") {
  const metadata = JSON.parse(execFileSync("cargo", ["metadata", "--locked", "--offline", "--format-version", "1", "--features", "nts-frontend-tsrs/tsrs"], { cwd: root, maxBuffer: 32 << 20 }).toString());
  const inventory: Attribution[] = [];
  mkdirSync(join(destination, "texts"), { recursive: true });
  for (const pkg of nativeRegistry) {
    const resolved = metadata.packages.find((p: Package) => key(p) === key(pkg) && p.source === pkg.source);
    if (!resolved?.license) throw new Error(`missing resolved licence: ${key(pkg)}`);
    const upstream = dirname(resolved.manifest_path);
    const names = readdirSync(upstream).filter((name) => /^(?:LICEN[CS]E|COPYING|COPYRIGHT|NOTICE|UNLICENSE)/i.test(name));
    if (resolved.license_file) names.push(relative(upstream, resolved.license_file));
    const texts = [...new Set(names)].sort().map((name) => {
      const bytes = readFileSync(join(upstream, name));
      const digest = sha256(bytes);
      writeFileSync(join(destination, "texts", `${digest}.txt`), bytes);
      return { upstream: name, sha256: digest };
    });
    if (!texts.length) throw new Error(`licence texts not packaged: ${key(pkg)}`);
    inventory.push({ name: pkg.name, version: pkg.version, source: pkg.source!, checksum: pkg.checksum!,
      license: resolved.license, repository: resolved.repository, texts });
  }
  writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
  writeFileSync(join(destination, "README.md"), `# Native frontend dependency attributions\n\nGenerated from Cargo.lock by \`node compiler/frontend-tsrs/licenses.ts --update\`.\nThe gate checks this inventory and each verbatim licence/notice text offline.\nThe native tsrs sources have their own LICENSE and NOTICE in third_party/tsrs.\nShip this directory with native frontend binary distributions.\n\n| Package | Version | Licence | Texts and notices |\n| --- | --- | --- | --- |\n${inventory.map((p) => `| ${p.name} | ${p.version} | ${p.license} | ${p.texts.map((t) => `[${t.upstream}](texts/${t.sha256}.txt)`).join(", ")} |`).join("\n")}\n`);
}

const inventory: Attribution[] = JSON.parse(readFileSync(inventoryPath, "utf8"));
const byKey = new Map(inventory.map((p) => [key(p), p]));
if (byKey.size !== inventory.length || byKey.size !== nativeRegistry.length) throw new Error("native attribution package inventory changed; run licenses.ts --update");
const textFiles = new Set<string>();
for (const pkg of nativeRegistry) {
  const attribution = byKey.get(key(pkg));
  if (!attribution || attribution.source !== pkg.source || attribution.checksum !== pkg.checksum || !attribution.license || !attribution.texts.length) {
    throw new Error(`native attribution missing or stale: ${key(pkg)}; run licenses.ts --update`);
  }
  for (const text of attribution.texts) {
    if (!/^[0-9a-f]{64}$/.test(text.sha256)) throw new Error("invalid attribution text digest");
    const name = `${text.sha256}.txt`;
    textFiles.add(name);
    if (sha256(readFileSync(join(destination, "texts", name))) !== text.sha256) throw new Error(`modified licence text: ${name}`);
  }
}
if (readdirSync(join(destination, "texts")).some((name) => !textFiles.has(name))) throw new Error("unlisted attribution text; remove texts no longer referenced after regeneration");
process.stdout.write(`frontend-tsrs attributions: ${nativeRegistry.length} packages, ${textFiles.size} verbatim texts verified\n`);
