// Vendors the React Compiler's Rust crates into third_party/react-compiler,
// verbatim, from a facebook/react checkout: every crate's Cargo.toml and src/,
// the licence, and a workspace root of their own so each crate's
// `version.workspace = true` resolves inside the copy rather than against
// nts's workspace, which excludes it.
//
// Vendored rather than a git dependency: a git dependency makes every lane
// fetch the whole react repository (~200 MB) to resolve the lockfile, where the
// crates are 3 MB. `--check` fails if the committed copy differs from the
// checkout, so the copy cannot drift from the revision UPSTREAM.md names.
//
// MANIFEST records every vendored file's hash beside the revision. `--check`
// with no checkout -- the gate's form, since the gate has no react clone --
// holds the copy to it: an edit to a vendored file, or a file added to or
// removed from the copy, fails it.
//
// usage: node tools/vendor-react-compiler.ts <react-checkout> [--check]
//        node tools/vendor-react-compiler.ts --check

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const lane = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(lane, "../../third_party/react-compiler");

const args = process.argv.slice(2);
const check = args.includes("--check");
const checkout = args.find((arg) => !arg.startsWith("--"));
const pinned: string = JSON.parse(readFileSync(join(lane, "upstream-compile/upstream.lock.json"), "utf8")).commit;

/** Every file under `dir`, as paths relative to `base`, sorted. */
function walk(dir: string, base: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path, base) : [relative(base, path)];
    });
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const manifestOf = (rev: string, files: Map<string, string>) =>
  `${rev}\n${[...files].map(([path, text]) => `${sha256(text)}  ${path}`).join("\n")}\n`;

/** The copy's files, as the manifest counts them: all but the manifest and build output. */
const copied = () => walk(target, target).filter((path) => path !== "MANIFEST" && path !== "Cargo.lock" && !path.startsWith("target/"));

if (!checkout) {
  if (!check) {
    console.error("usage: node tools/vendor-react-compiler.ts <react-checkout> [--check]\n       node tools/vendor-react-compiler.ts --check");
    process.exit(2);
  }
  const [rev, ...entries] = readFileSync(join(target, "MANIFEST"), "utf8").trimEnd().split("\n");
  const listed = new Map(entries.map((line) => [line.slice(66), line.slice(0, 64)] as const));
  const problems = [
    ...(rev === pinned ? [] : [`MANIFEST is ${rev}, but upstream-compile/upstream.lock.json pins ${pinned}`]),
    ...[...listed].filter(([path, hash]) => !existsSync(join(target, path)) || sha256(readFileSync(join(target, path), "utf8")) !== hash).map(([path]) => `changed or missing: ${path}`),
    ...copied().filter((path) => !listed.has(path)).map((path) => `not in the manifest: ${path}`),
  ];
  if (problems.length > 0) {
    console.error(`third_party/react-compiler is not the vendored ${rev}:\n  ${problems.slice(0, 20).join("\n  ")}`);
    process.exit(1);
  }
  console.log(`third_party/react-compiler is ${rev}, ${listed.size} files as vendored`);
  process.exit(0);
}

const git = (...argv: string[]) => execFileSync("git", ["-C", checkout, ...argv], { encoding: "utf8" }).trim();
const rev = git("rev-parse", "HEAD");
// One pin: the revision the lane's conformance tests run at.
if (rev !== pinned) {
  throw new Error(`${checkout} is at ${rev}, but upstream-compile/upstream.lock.json pins ${pinned}: move both together`);
}
if (git("status", "--porcelain", "--", "compiler/crates", "compiler/Cargo.toml", "LICENSE") !== "") {
  throw new Error(`${checkout} has local changes under compiler/crates: vendor a clean revision`);
}

const upstream = join(checkout, "compiler");
const files = new Map<string, string>();
// Crates are the directories: `crates/` also holds upstream's TODO.md.
const crates = readdirSync(join(upstream, "crates"))
  .filter((name) => existsSync(join(upstream, "crates", name, "Cargo.toml")))
  .sort();
for (const crate of crates) {
  const root = join(upstream, "crates", crate);
  files.set(`crates/${crate}/Cargo.toml`, readFileSync(join(root, "Cargo.toml"), "utf8"));
  for (const path of walk(join(root, "src"), root)) {
    files.set(`crates/${crate}/${path}`, readFileSync(join(root, path), "utf8"));
  }
}
files.set("LICENSE", readFileSync(join(checkout, "LICENSE"), "utf8"));

// The workspace root: upstream's shared package fields and dependency table,
// verbatim, over the crates alone (not the napi package, which is not copied).
const manifest = readFileSync(join(upstream, "Cargo.toml"), "utf8");
const section = (name: string) => {
  const start = manifest.indexOf(`[${name}]`);
  if (start < 0) throw new Error(`compiler/Cargo.toml has no [${name}]: its shape changed`);
  const next = manifest.indexOf("\n[", start + 1);
  return manifest.slice(start, next < 0 ? undefined : next).trimEnd();
};
files.set(
  "Cargo.toml",
  `# Generated by runtime/react/tools/vendor-react-compiler.ts from facebook/react
# ${rev}. The crates' own workspace, so their inherited fields resolve here;
# nts's workspace excludes this directory and depends on the crates by path.

[workspace]
members = ["crates/*"]
resolver = "3"

${section("workspace.package")}

${section("workspace.dependencies")}
`,
);
files.set(
  "UPSTREAM.md",
  `# The React Compiler, vendored

The Rust crates of [facebook/react](https://github.com/facebook/react)'s
compiler, at \`${rev}\`, unmodified: each crate's \`Cargo.toml\` and \`src/\`,
and the licence (MIT). \`Cargo.toml\` here is generated: upstream's workspace
fields over these crates alone.

To move the pin, check facebook/react out at the new revision and run, from
\`runtime/react\`:

    node tools/vendor-react-compiler.ts <react-checkout>

\`--check\` compares this copy with a checkout instead of writing it; with
no checkout, with MANIFEST, which is what the gate runs.
`,
);
files.set(".gitignore", "/target\n/Cargo.lock\n");
files.set("MANIFEST", manifestOf(rev, files));

if (check) {
  const present = existsSync(target) ? copied() : [];
  const stale = [
    ...[...files.keys()].filter((path) => !existsSync(join(target, path)) || readFileSync(join(target, path), "utf8") !== files.get(path)),
    ...present.filter((path) => !files.has(path)),
  ];
  if (stale.length > 0) {
    console.error(`third_party/react-compiler differs from ${rev}:\n  ${stale.slice(0, 20).join("\n  ")}`);
    process.exit(1);
  }
  console.log(`third_party/react-compiler is ${rev}`);
} else {
  rmSync(target, { recursive: true, force: true });
  for (const [path, text] of files) {
    mkdirSync(dirname(join(target, path)), { recursive: true });
    writeFileSync(join(target, path), text);
  }
  console.log(`vendored ${files.size} files from ${rev} into third_party/react-compiler`);
}
