import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {test} from "node:test";
import {checkBenchmarkInputs} from "../licenses/benchmark-inputs.ts";
import {spawnTest} from "./test-wait.ts";

const repository = fileURLToPath(new URL("../..", import.meta.url));
const casePath = "benchmarks/cases/input-control";
const inputPath = `${casePath}/data`;
// Synthetic licence metadata, never shipped as an upstream licence text.
const licence = "Creative Commons Attribution 4.0 International\nCC-BY-4.0\nLicensed Material\nSection 3\n";
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
function fixture() {
  const parent = join(homedir(), ".cache/nts-scratch/benchmark-input-controls");
  mkdirSync(parent, {recursive: true});
  const root = mkdtempSync(join(parent, "test-"));
  const git = (...args: string[]) => {
    const result = spawnTest("git", args, {cwd: root, encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr); return result.stdout;
  };
  git("init", "-q");
  const write = (path: string, contents: string) => {
    mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), contents);
    git("add", "--", path);
  };
  const input = {
    directory: inputPath, upstream: "https://upstream.invalid/data/commit-01234567",
    license: {spdx: "CC-BY-4.0", path: `${inputPath}/LICENSE`, sha256: sha256(licence)},
    provenance: {path: `${casePath}/provenance.md`, attribution: "Control data by Upstream, CC-BY-4.0."},
    files: [{path: `${inputPath}/packed.json`, sha256: sha256('{"packed":[1,2]}\n')}],
  };
  const manifest = () => write(`${casePath}/input-licenses.json`, JSON.stringify({version: 1, inputs: [input]}));
  write(input.license.path, licence);
  write(input.files[0]!.path, '{"packed":[1,2]}\n');
  write(input.provenance.path, input.provenance.attribution + "\n" + input.upstream + "\n");
  write(`${casePath}/case.ts`, 'import {readFileSync} from "node:fs"; export const input = readFileSync(new URL("./data/packed.json", import.meta.url), "utf8");\n');
  write(`${casePath}/tsconfig.json`, JSON.stringify({compilerOptions: {module: "preserve", moduleResolution: "bundler"}, files: ["case.ts"]}));
  manifest();
  return {root, input, write, git, manifest, check: () => checkBenchmarkInputs(root), close: () => rmSync(root, {recursive: true, force: true})};
}

test("CC-BY input remains opaque benchmark data with full attribution", () => {
  const f = fixture();
  try {assert.deepEqual(f.check(), {inputs: 1, files: 1});} finally {f.close();}
});

test("native syntax capture handles template continuations containing another language", () => {
  const f = fixture();
  try {
    f.write(`${casePath}/case.ts`, 'const name = "Control"; export const rust = `pub enum ${name} {\n#[derive(Debug)]\nValue\n}`;');
    assert.deepEqual(f.check(), {inputs: 1, files: 1});
  } finally {f.close();}
});

test("a full upstream licence title discovers undeclared input without an SPDX token", () => {
  const f = fixture();
  try {
    f.git("rm", "--cached", "--", `${casePath}/input-licenses.json`);
    f.write(f.input.license.path, "Attribution 4.0 International\nLicensed Material\nSection 3\n");
    assert.throws(f.check, /undeclared CC-BY-4\.0 material/);
  } finally {f.close();}
});

test("only the exact existing attributed tsrs notice is admitted", () => {
  const f = fixture();
  try {
    const path = "third_party/tsrs/NOTICE", notice = readFileSync(join(repository, path), "utf8");
    f.write(path, notice);
    assert.deepEqual(f.check(), {inputs: 1, files: 1});
    f.write(path, notice + "\n");
    assert.throws(f.check, /existing attributed CC-BY component notice changed.*third_party\/tsrs\/NOTICE/);
    f.write(path, notice);
    f.write("third_party/control/NOTICE", "Third-party notices.\nDOM component:\nAttribution 4.0 International\n");
    assert.throws(f.check, /undeclared CC-BY-4\.0 material.*third_party\/control\/NOTICE/);
  } finally {f.close();}
});

test("CC-BY source cannot evade discovery by living under a documentation directory", () => {
  const f = fixture();
  try {
    f.write("docs/control.ts", "// SPDX-License-Identifier: CC-BY-4.0\nexport const value = 1;");
    assert.throws(f.check, /undeclared CC-BY-4\.0 material.*docs\/control\.ts/);
  } finally {f.close();}
});

for (const [name, contents] of [
  ["malformed JSON", '{"compilerOptions":'],
  ["missing inherited config", '{"extends":"./missing.json","files":["case.ts"]}'],
] as const) test(`an unavailable graph from ${name} fails closed`, () => {
  const f = fixture();
  try {
    f.write(`${casePath}/tsconfig.json`, contents);
    assert.throws(f.check, /cannot audit project config.*TS\d+/);
  } finally {f.close();}
});

for (const [name, code] of [
  ["import", 'import data from "./data/packed.json"; export {data};'],
  ["re-export", 'export {default} from "./data/packed.json";'],
  ["require", 'export const data = require("./data/packed.json");'],
  ["dynamic import", 'export const data = import("./data/packed.json");'],
  ["type-only import", 'import type data from "./data/packed.json";'],
  ["import equals", 'import data = require("./data/packed.json");'],
] as const) test(`CC-BY data cannot enter benchmark code through ${name}`, () => {
  const f = fixture();
  try {f.write(`${casePath}/case.ts`, code); assert.throws(f.check, /cannot be imported or re-exported.*case\.ts.*packed\.json/);} finally {f.close();}
});

test("runtime transitive re-export resolves tsconfig aliases to a restricted input", () => {
  const f = fixture();
  try {
    f.write("runtime/control/main.ts", 'export {data} from "./middle.ts";');
    f.write("runtime/control/middle.ts", 'export {default as data} from "@input";');
    f.write("runtime/control/tsconfig.json", JSON.stringify({compilerOptions: {baseUrl: ".", paths: {"@input": ["../../" + inputPath + "/packed.json"]}}, files: ["main.ts"]}));
    assert.throws(f.check, /cannot enter the resolved compilation graph: runtime\/control\/tsconfig\.json/);
  } finally {f.close();}
});

test("runtime file reads are forbidden even though the same benchmark read is allowed", () => {
  const f = fixture();
  try {
    assert.equal(f.check().inputs, 1);
    f.write("runtime/control.ts", `import {readFileSync} from "node:fs"; readFileSync(${JSON.stringify(inputPath + "/packed.json")});`);
    assert.throws(f.check, /cannot be read outside benchmarks: runtime\/control\.ts/);
  } finally {f.close();}
});

test("a CC-BY unpacker is executable code, including an explicit project root", () => {
  const f = fixture();
  try {
    const unpacker = "export const unpack = (n) => n + 1;\n";
    f.write(`${inputPath}/unpack.js`, unpacker);
    f.input.files.push({path: `${inputPath}/unpack.js`, sha256: sha256(unpacker)}); f.manifest();
    f.write(`${casePath}/case.ts`, 'import {unpack} from "./data/unpack.js"; export const work = unpack(1);');
    assert.throws(f.check, /cannot be imported or re-exported.*unpack\.js/);
    f.write(`${casePath}/case.ts`, "export const work = 1;");
    f.write(`${casePath}/tsconfig.json`, JSON.stringify({compilerOptions: {allowJs: true}, files: ["case.ts", "data/unpack.js"]}));
    assert.throws(f.check, /cannot be a compiled project root.*unpack\.js/);
  } finally {f.close();}
});

test("module resolution follows a package entry and a symlink into input", () => {
  const f = fixture();
  try {
    const module = "export const value = 1;";
    f.write(`${inputPath}/packed.ts`, module);
    f.input.files.push({path: `${inputPath}/packed.ts`, sha256: sha256(module)}); f.manifest();
    f.write("runtime/package.json", JSON.stringify({name: "control", imports: {"#input": "../" + inputPath + "/packed.ts"}}));
    mkdirSync(join(f.root, "runtime/node_modules/input"), {recursive: true});
    symlinkSync(join(f.root, inputPath, "packed.ts"), join(f.root, "runtime/node_modules/input/index.d.ts"));
    f.write("runtime/main.ts", 'export {value} from "input";');
    assert.throws(f.check, /cannot enter the resolved compilation graph.*packed\.ts/);
  } finally {f.close();}
});

for (const [name, path, code] of [
  ["C include", "runtime/control.c", `#include "../${inputPath}/packed.json"\n`],
  ["C embed", "runtime/control.c", `#embed "../${inputPath}/packed.json"\n`],
  ["Rust bytes", "compiler/control.rs", `const DATA: &[u8] = include_bytes!("../${inputPath}/packed.json");`],
  ["Rust raw string", "compiler/control.rs", `const DATA: &str = include_str!(r#"../${inputPath}/packed.json"#);`],
  ["Rust crate concat", "compiler/control/src/lib.rs", `const DATA: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../${inputPath}/packed.json"));`],
] as const) test(`CC-BY input cannot be linked by ${name}`, () => {
  const f = fixture();
  try {
    if (name === "Rust crate concat") f.write("compiler/control/Cargo.toml", '[package]\nname="control"\n');
    f.write(path, code); assert.throws(f.check, /cannot be (?:included|embedded) in native code/);
  } finally {f.close();}
});

for (const [name, mutate, expected] of [
  ["missing manifest", (f: ReturnType<typeof fixture>) => {f.git("rm", "--cached", "--", `${casePath}/input-licenses.json`);}, /undeclared CC-BY-4\.0 material/],
  ["changed bytes", (f: ReturnType<typeof fixture>) => f.write(f.input.files[0]!.path, "changed"), /input hash changed/],
  ["missing attribution", (f: ReturnType<typeof fixture>) => f.write(f.input.provenance.path, f.input.upstream), /attribution or upstream missing/],
  ["undeclared file", (f: ReturnType<typeof fixture>) => f.write(`${inputPath}/unpack.js`, "doWork();"), /undeclared benchmark input file/],
  ["unknown version", (f: ReturnType<typeof fixture>) => f.write(`${casePath}/input-licenses.json`, JSON.stringify({version: 2, inputs: [f.input]})), /expected version 1/],
  ["duplicate directory", (f: ReturnType<typeof fixture>) => f.write(`${casePath}/input-licenses.json`, JSON.stringify({version: 1, inputs: [f.input, f.input]})), /duplicate or overlapping/],
  ["path escape", (f: ReturnType<typeof fixture>) => {f.input.directory = `${casePath}/../elsewhere`; f.manifest();}, /normalized repository-relative path/],
  ["outside benchmarks", (f: ReturnType<typeof fixture>) => {f.input.directory = "runtime/data"; f.manifest();}, /must be beneath its benchmark case/],
  ["unknown field", (f: ReturnType<typeof fixture>) => f.write(`${casePath}/input-licenses.json`, JSON.stringify({version: 1, inputs: [f.input], allowCode: true})), /expected exactly/],
  ["missing input", (f: ReturnType<typeof fixture>) => f.git("rm", "--cached", "--", f.input.files[0]!.path), /untracked or missing/],
  ["deed instead of full licence", (f: ReturnType<typeof fixture>) => {f.write(f.input.license.path, "CC-BY-4.0 deed"); f.input.license.sha256 = sha256("CC-BY-4.0 deed"); f.manifest();}, /full CC-BY-4.0 licence/],
] as const) test(`CC-BY inventory refuses ${name}`, () => {
  const f = fixture();
  try {mutate(f); assert.throws(f.check, expected);} finally {f.close();}
});

test("input symlinks cannot move admitted material outside its case", () => {
  const f = fixture();
  try {
    rmSync(join(f.root, f.input.files[0]!.path));
    f.write("elsewhere.json", '{"packed":[1,2]}\n');
    symlinkSync(join(f.root, "elsewhere.json"), join(f.root, f.input.files[0]!.path));
    f.git("add", "--", f.input.files[0]!.path);
    assert.throws(f.check, /must not traverse a symlink/);
  } finally {f.close();}
});

test("inherited include rules cannot make opaque input a compiled root", () => {
  const f = fixture();
  try {
    const data = "export const packed = 1;";
    f.write(`${inputPath}/packed.js`, data);
    f.input.files.push({path: `${inputPath}/packed.js`, sha256: sha256(data)}); f.manifest();
    f.write(`${casePath}/tsconfig-base.json`, JSON.stringify({compilerOptions: {allowJs: true}, include: ["**/*.js"]}));
    f.write(`${casePath}/tsconfig.json`, JSON.stringify({extends: "./tsconfig-base.json"}));
    assert.throws(f.check, /cannot be a compiled project root.*packed\.js/);
  } finally {f.close();}
});

test("the real licences CLI invokes the input guard before accepting a compiler inventory", () => {
  const f = fixture();
  try {
    for (const path of ["tooling/licenses/licenses.ts", "tooling/licenses/benchmark-inputs.ts", "build/node-deps/recipes.json"]) {
      mkdirSync(dirname(join(f.root, path)), {recursive: true}); cpSync(join(repository, path), join(f.root, path));
    }
    symlinkSync(resolve(repository, "node_modules"), join(f.root, "node_modules"));
    f.write(`${casePath}/case.ts`, 'import data from "./data/packed.json";');
    const result = spawnTest(process.execPath, [join(f.root, "tooling/licenses/licenses.ts"), "--check"], {cwd: f.root, encoding: "utf8"});
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /CC-BY benchmark input cannot be imported/);
    assert.doesNotMatch(result.stderr, /Cargo.lock|MODULE_NOT_FOUND/);
  } finally {f.close();}
});
