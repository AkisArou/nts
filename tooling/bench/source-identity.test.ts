import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cargoSync } from "../gate/cargo.ts";
import { gitArguments } from "../gate/git-arguments/main.ts";
import { fixtureEnvironment } from "../gate/test-environment.ts";
import { digestOf, sourceDigest, sourceRoots, uncoveredDepInfo, type SourceBinary } from "./source-identity.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const BINARIES: { binary: SourceBinary; crate: string }[] = [{ binary: "nts", crate: "nts-cli" }, { binary: "nts-bench", crate: "nts-bench" }];

test("each binary's roots cover its whole Cargo path-dependency closure", t => {
  const metadata = cargoSync(["metadata", "--format-version", "1", "--offline", "--locked"], { cwd: root, env: fixtureEnvironment(t), encoding: "utf8", maxBuffer: 1 << 28 });
  assert.equal(metadata.status, 0, metadata.stderr);
  const parsed = JSON.parse(metadata.stdout) as {
    workspace_root: string;
    packages: { id: string; name: string; source: string | null; manifest_path: string }[];
    resolve: { nodes: { id: string; deps: { pkg: string; dep_kinds: { kind: string | null }[] }[] }[] };
  };
  const packages = new Map(parsed.packages.map((one) => [one.id, one]));
  const nodes = new Map(parsed.resolve.nodes.map((node) => [node.id, node]));
  for (const { binary, crate } of BINARIES) {
    const roots = sourceRoots(binary);
    const start = parsed.packages.find((one) => one.name === crate)!.id, seen = new Set<string>(), pending = [start];
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      // What links into the binary or builds it: normal and build edges, never dev-only ones.
      for (const dep of nodes.get(id)!.deps) if (dep.dep_kinds.some((kind) => kind.kind === null || kind.kind === "build")) pending.push(dep.pkg);
    }
    const directories = [...seen].map((id) => packages.get(id)!).filter((one) => one.source === null)
      .map((one) => relative(parsed.workspace_root, dirname(one.manifest_path)));
    assert.ok(directories.length > 10, `${crate} has a path closure`);
    const uncovered = directories.filter((directory) => !roots.some((path) => directory === path || directory.startsWith(path + "/")));
    assert.deepEqual(uncovered, [], `${binary}'s roots in tooling/cli/source-roots.txt miss path dependencies of ${crate}`);
    for (const file of ["Cargo.toml", "Cargo.lock"]) assert.ok(roots.includes(file), `${binary} covers ${file}`);
  }
});

test("control: a closure check over a list missing one dependency names it", () => {
  const roots = sourceRoots("nts", "nts: Cargo.toml Cargo.lock compiler\n");
  assert.deepEqual(roots, ["Cargo.toml", "Cargo.lock", "compiler"]);
  const missing = ["compiler/core", "tooling/deps"].filter((directory) => !roots.some((path) => directory === path || directory.startsWith(path + "/")));
  assert.deepEqual(missing, ["tooling/deps"]);
  assert.throws(() => sourceRoots("nts-bench", "nts: compiler\n"), /names no roots for nts-bench/);
});

test("a clean checkout's files on disk digest as its HEAD's blobs do, and any edit or other commit differs", () => {
  const head = execFileSync("git", gitArguments(["rev-parse", "HEAD"]), { cwd: root, encoding: "utf8" }).trim();
  for (const { binary } of BINARIES) {
    // The working-tree side, as source_identity.rs reads it: tracked or untracked-not-ignored files that exist.
    const listed = execFileSync("git", gitArguments(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...sourceRoots(binary)]), { cwd: root })
      .toString("utf8").split("\0").filter(Boolean);
    const dirty = execFileSync("git", gitArguments(["status", "--porcelain", "--", ...sourceRoots(binary)]), { cwd: root, encoding: "utf8" }).trim();
    const files = [...new Set(listed)].filter((path) => existsSync(join(root, path)) || lstatSync(join(root, path), { throwIfNoEntry: false }))
      .map((path) => ({ path, content: lstatSync(join(root, path)).isSymbolicLink() ? Buffer.from(readlinkSync(join(root, path))) : readFileSync(join(root, path)) }));
    const onDisk = digestOf(files), atHead = sourceDigest(root, head, binary);
    if (dirty === "") assert.equal(onDisk, atHead, `${binary}: a clean checkout is its commit`);
    else assert.notEqual(onDisk, atHead, `${binary}: an edited checkout is not its commit`);
    const edited = files.map((file, index) => index === 0 ? { ...file, content: Buffer.concat([file.content, Buffer.from(" ")]) } : file);
    assert.notEqual(digestOf(edited), onDisk, "one byte changes the digest");
    assert.notEqual(digestOf(files.slice(1)), onDisk, "a missing file changes the digest");
  }
  assert.equal(digestOf([{ path: "b", content: Buffer.from("2") }, { path: "a", content: Buffer.from("1") }]),
    createHash("sha256").update(`nts-source-v1\na\0${createHash("sha256").update("1").digest("hex")}\nb\0${createHash("sha256").update("2").digest("hex")}\n`).digest("hex"),
    "the format source_identity.rs states, in byte order of path");
});

test("every repository file a binary's dep-info names lies under its roots or a pinned path", () => {
  const roots = readFileSync(join(root, "tooling/cli/source-roots.txt"), "utf8");
  const info = (paths: string[]) => `${root}target/release/nts: ${paths.map((path) => root + path).join(" ")}\n`;
  const read = ["Cargo.lock", "build/../.tool-versions", "build/../tooling/config/src/profiles/data.json", "build/../third_party/node-source/LICENSE",
    "tooling/differential/src/../../../results/differential-call-costs/calibration.json", "compiler/frontend-tsrs/../../rust-toolchain.toml", "target/release/build/x/out/gen.rs"];
  assert.deepEqual(uncoveredDepInfo(info(read), "nts", roots), [], "normalized, pinned and build output paths are covered or ignored");
  // Control: the roots without the profiles directory miss the profile data nts build reads.
  const without = roots.replace(" tooling/config/src/profiles", "");
  assert.notEqual(without, roots);
  assert.deepEqual(uncoveredDepInfo(info(read), "nts", without), ["tooling/config/src/profiles/data.json"]);
  assert.deepEqual(uncoveredDepInfo(info(["Cargo.lock", "tooling/bootstrap/awfy.pin"]), "nts-bench", roots.replace(" tooling/bootstrap/awfy.pin", "")), ["tooling/bootstrap/awfy.pin"]);
  assert.throws(() => uncoveredDepInfo("target/release/nts: /x/y.rs\n", "nts", roots), /names no Cargo.lock/);
  // The tree's own builds, where they exist: what Cargo recorded for each binary.
  for (const profile of ["nts-dev", "release"]) for (const { binary } of BINARIES) {
    const file = join(root, "target", profile, binary + ".d");
    if (existsSync(file)) assert.deepEqual(uncoveredDepInfo(readFileSync(file, "utf8"), binary), [], `${profile}/${binary}.d`);
  }
});
