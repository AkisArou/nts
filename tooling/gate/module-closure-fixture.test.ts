import assert from "node:assert/strict";
import {existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test, type TestContext} from "node:test";
import {copyModuleClosure, moduleClosure} from "./module-closure-fixture.ts";
import {spawnTest} from "./test-wait.ts";
import {testScratch} from "./test-scratch.ts";

function fixture(t: TestContext) {
  const root = testScratch(t, "module-closure"), source = join(root, "source"), destination = join(root, "destination");
  mkdirSync(source);
  const write = (name: string, value: string) => {const path = join(source, name); mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, value);};
  return {source, destination, write};
}

test("the public parser follows transitive imports, re-exports, type imports and cycles", t => {
  const f = fixture(t);
  f.write("entry.ts", `import './side.ts'; import type {T} from './types.ts'; export * from './middle.ts';
// import './comment.ts';
const data = "import './data.ts'"; void data;
`);
  f.write("side.ts", "export const side = 1;");
  f.write("types.ts", "export type T = number;");
  f.write("middle.ts", "export {leaf} from './nested/leaf.ts'; export type {T} from './types.ts';");
  f.write("nested/leaf.ts", "import '../entry.ts'; export const leaf = 2;");
  const expected = ["entry.ts", "middle.ts", "nested/leaf.ts", "side.ts", "types.ts"];
  assert.deepEqual(moduleClosure(["entry.ts", "side.ts"], {sourceRoot: f.source}), expected);
  assert.deepEqual(moduleClosure(["side.ts", "entry.ts"], {sourceRoot: f.source}), expected);
  assert.deepEqual(copyModuleClosure(["entry.ts"], f.destination, {sourceRoot: f.source}), expected);
  for (const file of expected) assert.deepEqual(readFileSync(join(f.destination, file)), readFileSync(join(f.source, file)));
  assert.equal(existsSync(join(f.destination, "data.ts")), false);
});

for (const link of [false, true]) test(`the complete ${link ? "linked" : "copied"} graph executes`, t => {
  const f = fixture(t);
  f.write("entry.mjs", "import {value} from './middle.mjs'; console.log(value);");
  f.write("middle.mjs", "export {value} from './nested/leaf.mjs';");
  f.write("nested/leaf.mjs", "export const value = 19;");
  const files = copyModuleClosure(["entry.mjs"], f.destination, {sourceRoot: f.source, link});
  assert.deepEqual(files, ["entry.mjs", "middle.mjs", "nested/leaf.mjs"]);
  assert.ok(files.every(file => lstatSync(join(f.destination, file)).isSymbolicLink() === link));
  const actual = spawnTest(process.execPath, [join(f.destination, "entry.mjs")], {encoding: "utf8"});
  assert.equal(actual.status, 0, actual.stderr); assert.equal(actual.stdout, "19\n"); assert.equal(actual.stderr, "");
});

test("new source imports are observed without a persistent closure cache", t => {
  const f = fixture(t); f.write("entry.ts", "export const value = 1;");
  assert.deepEqual(moduleClosure(["entry.ts"], {sourceRoot: f.source}), ["entry.ts"]);
  f.write("entry.ts", "export {value} from './new.ts';"); f.write("new.ts", "export const value = 2;");
  assert.deepEqual(moduleClosure(["entry.ts"], {sourceRoot: f.source}), ["entry.ts", "new.ts"]);
});

test("parsed module-relative URL assets include modules and leaves, while lookalikes and anchors declare nothing", t => {
  const f = fixture(t);
  f.write("entry.ts", `
const leaf = new URL('./data.json', import.meta.url);
const worker = new URL('./worker.ts', import.meta.url);
const anchors = [new URL('.', import.meta.url), new URL('../', import.meta.url), new URL('../..', import.meta.url)];
const data = "new URL('./absent.ts', import.meta.url)";
const other = new OtherURL('./absent.ts', import.meta.url);
const call = URL('./absent.ts', import.meta.url);
const base = new URL('./absent.ts', somewhereElse);
const dynamic = new URL(name, import.meta.url);
// new URL('./absent.ts', import.meta.url);
`);
  f.write("data.json", '"import \'./absent.ts\';"');
  f.write("worker.ts", "export {value} from './shared.ts';");
  f.write("shared.ts", "export const value = 1;");
  assert.deepEqual(moduleClosure(["entry.ts"], {sourceRoot: f.source}), ["data.json", "entry.ts", "shared.ts", "worker.ts"]);
  assert.deepEqual(copyModuleClosure(["entry.ts"], f.destination, {sourceRoot: f.source}), ["data.json", "entry.ts", "shared.ts", "worker.ts"]);
  assert.equal(readFileSync(join(f.destination, "data.json"), "utf8"), '"import \'./absent.ts\';"');
});

test("a named URL directory declares its tracked files with either spelling and reports its breadth", t => {
  const f = fixture(t);
  f.write("entry.ts", "const first = new URL('./assets', import.meta.url); const second = new URL('./assets/', import.meta.url);");
  f.write("assets/data.txt", "fixture asset");
  f.write("assets/worker.ts", "import '../shared.ts';");
  f.write("shared.ts", "export const value = 1;");
  for (const args of [["init", "--quiet", "--initial-branch=main"], ["add", "entry.ts", "assets", "shared.ts"]]) {
    const result = spawnTest("git", args, {cwd: f.source, encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr);
  }
  f.write("assets/untracked.txt", "not a source-tree input");
  const directories: import("./module-closure.ts").DirectoryDeclaration[] = [];
  assert.deepEqual(moduleClosure(["entry.ts"], {sourceRoot: f.source, directory: row => directories.push(row)}), ["assets/data.txt", "assets/worker.ts", "entry.ts", "shared.ts"]);
  assert.ok(directories.length > 0);
  for (const row of directories) assert.deepEqual(row, {reader: "entry.ts", directory: "assets", files: ["assets/data.txt", "assets/worker.ts"]});
});

test("missing imports and escaping edges fail before partial publication", t => {
  const f = fixture(t); f.write("entry.ts", "import './missing.ts';");
  assert.throws(() => copyModuleClosure(["entry.ts"], f.destination, {sourceRoot: f.source}), /missing\.ts/);
  assert.equal(existsSync(f.destination), false);
  f.write("entry.ts", "import '../outside.ts';");
  assert.throws(() => moduleClosure(["entry.ts"], {sourceRoot: f.source}), /escapes source root/);
});

test("materialisation preserves a different private fixture module", t => {
  const f = fixture(t); f.write("entry.ts", "export const value = 1;");
  copyModuleClosure(["entry.ts"], f.destination, {sourceRoot: f.source});
  writeFileSync(join(f.destination, "entry.ts"), "private mutation\n");
  assert.throws(() => copyModuleClosure(["entry.ts"], f.destination, {sourceRoot: f.source}), /different input/);
  assert.equal(readFileSync(join(f.destination, "entry.ts"), "utf8"), "private mutation\n");
});

for (const link of [false, true]) test(`a ${link ? "linked" : "copied"} fixture resolves its destination before creating directories`, t => {
  const f = fixture(t); f.write("entry.ts", "export const value = 19;");
  const control = join(f.destination, "fixture");
  assert.deepEqual(copyModuleClosure(["entry.ts"], control, {sourceRoot: f.source, link}), ["entry.ts"]);
  assert.equal(readFileSync(join(control, "entry.ts"), "utf8"), "export const value = 19;");
  assert.equal(lstatSync(join(control, "entry.ts")).isSymbolicLink(), link);
  const alias = join(dirname(f.destination), "alias"); symlinkSync(f.source, alias);
  const destination = join(alias, "fixture");
  let problem: unknown;
  try {copyModuleClosure(["entry.ts"], destination, {sourceRoot: f.source, link});} catch (error) {problem = error;}
  t.diagnostic(JSON.stringify({control: "copied normally", link, destination, refused: problem instanceof Error, sourceFixtureCreated: existsSync(join(f.source, "fixture"))}));
  assert.match(problem instanceof Error ? problem.message : "did not refuse", /fixture destination resolves inside source tree/);
  assert.equal(existsSync(join(f.source, "fixture")), false, "refuse before any mkdir or source write");
});
