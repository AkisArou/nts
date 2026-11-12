import {gitArguments} from "./git-arguments/main.ts";
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

test('a namespace mirror reuses exact source links and copies declared assets outside it',t=>{
  const f=fixture(t);
  f.write('tooling/entry.ts',"export const input=new URL('../results/input.json',import.meta.url);");
  f.write('results/input.json','{"owned":true}\n');
  mkdirSync(f.destination);symlinkSync(join(f.source,'tooling'),join(f.destination,'tooling'),'dir');
  const before=readFileSync(join(f.source,'tooling/entry.ts'));
  assert.throws(()=>copyModuleClosure(['tooling/entry.ts'],f.destination,{sourceRoot:f.source}),/parent is not a directory/);
  assert.deepEqual(copyModuleClosure(['tooling/entry.ts'],f.destination,{sourceRoot:f.source,reuseSourceLinks:true}),['results/input.json','tooling/entry.ts']);
  assert.equal(lstatSync(join(f.destination,'results/input.json')).isSymbolicLink(),false);
  assert.deepEqual(readFileSync(join(f.destination,'results/input.json')),readFileSync(join(f.source,'results/input.json')));
  assert.deepEqual(readFileSync(join(f.source,'tooling/entry.ts')),before,'the linked source was never written');
});

test('namespace reuse never writes a missing input through a linked parent',t=>{
  const f=fixture(t),foreign=join(dirname(f.destination),'foreign');
  f.write('entry.ts',"export const input=new URL('./results/input.json',import.meta.url);");
  f.write('results/input.json','{}');
  mkdirSync(f.destination);mkdirSync(foreign);symlinkSync(foreign,join(f.destination,'results'),'dir');
  assert.throws(()=>copyModuleClosure(['entry.ts'],f.destination,{sourceRoot:f.source,reuseSourceLinks:true}),/parent is not a directory/);
  assert.equal(existsSync(join(foreign,'input.json')),false);
});

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

test("literal relative dynamic imports declare inputs while computed imports remain undeclared", t => {
  const f = fixture(t);
  f.write("entry.ts", [
    "export async function literal() {return import('./lazy.ts');}",
    "export async function template(name: string) {return import(`./${name}.ts`);}",
    "export async function variable(name: string) {return import(name);}",
    "const data = \"import('./absent.ts')\"; void data;",
  ].join("\n"));
  f.write("lazy.ts", "export {value} from './dependency.ts';");
  f.write("dependency.ts", "export const value = 23;");
  assert.deepEqual(moduleClosure(["entry.ts"], {sourceRoot: f.source}), ["dependency.ts", "entry.ts", "lazy.ts"]);
  assert.deepEqual(copyModuleClosure(["entry.ts"], f.destination, {sourceRoot: f.source}), ["dependency.ts", "entry.ts", "lazy.ts"]);
});

test("owning-project staging preserves inherited configs and follows newly declared roots", t => {
  const f = fixture(t);
  f.write("base.json", '{"compilerOptions":{"target":"ES2024","module":"nodenext","allowImportingTsExtensions":true,"noEmit":true}}');
  f.write("project/tsconfig.json", '{"extends":"../base.json","files":["src/entry.ts"]}');
  f.write("project/src/entry.ts", "export const value: number = 19; console.log(value);");
  const first = copyModuleClosure(["project/src/entry.ts"], f.destination, {sourceRoot: f.source, owningProject: true});
  assert.deepEqual(first, ["base.json", "project/src/entry.ts", "project/tsconfig.json"]);
  for (const file of first) assert.deepEqual(readFileSync(join(f.destination, file)), readFileSync(join(f.source, file)));
  f.write("project/tsconfig.json", '{"extends":"../base.json","files":["src/entry.ts","src/registered.ts"]}');
  f.write("project/src/registered.ts", "import {value} from './dependency.ts'; console.log(value);");
  f.write("project/src/dependency.ts", "export const value: number = 23;");
  const destination = join(f.destination, "new-root");
  const second = copyModuleClosure(["project/src/entry.ts"], destination, {sourceRoot: f.source, owningProject: true});
  assert.deepEqual(second, ["base.json", "project/src/dependency.ts", "project/src/entry.ts", "project/src/registered.ts", "project/tsconfig.json"]);
  assert.equal(readFileSync(join(destination, "project/tsconfig.json"), "utf8"), readFileSync(join(f.source, "project/tsconfig.json"), "utf8"));
  const result = spawnTest(process.execPath, [join(destination, "project/src/registered.ts")], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, "23\n");
});

test("owning-project staging refuses missing and escaping projects before copying", t => {
  const f = fixture(t); f.write("entry.ts", "export const value = 19;");
  assert.throws(() => copyModuleClosure(["entry.ts"], f.destination, {sourceRoot: f.source, owningProject: true}), /no owning project|escapes source root/);
  assert.equal(existsSync(f.destination), false);
  f.write("tsconfig.json", '{"extends":"../outside.json","files":["entry.ts"]}');
  writeFileSync(join(f.source, "../outside.json"), '{"compilerOptions":{"noEmit":true}}');
  assert.throws(() => copyModuleClosure(["entry.ts"], f.destination, {sourceRoot: f.source, owningProject: true}), /escapes source root/);
  assert.equal(existsSync(f.destination), false);
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
    const result = spawnTest("git", gitArguments(args), {cwd: f.source, encoding: "utf8"});
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
