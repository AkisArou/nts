import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const generator = "compiler/codegen/jvm/generate-members.ts";
const catalogue = "compiler/codegen/jvm/member-names.json";
const model = JSON.parse(readFileSync(join(root, catalogue), "utf8")) as {
  prefix: string;
  java_templates: {template: string; output: string}[];
};

test("the real exclusivity scanner checks NUL-bearing source and unknown data", () => {
  const parent = join(root, "target/member-name-tests");
  mkdirSync(parent, {recursive: true});
  const dir = mkdtempSync(join(parent, "scanner-"));
  try {
    const inputs = [generator, catalogue, "compiler/codegen/jvm/member-grammar.ts",
      "compiler/codegen/jvm/src/generated_members.rs", "compiler/codegen/jvm/generated-members.json",
      "runtime/jvm/nts-runtime.jar",
      ...model.java_templates.flatMap(row => [row.template, row.output])];
    for (const input of inputs) {
      const target = join(dir, input);
      mkdirSync(dirname(target), {recursive: true});
      copyFileSync(join(root, input), target);
    }
    const initialized = spawnSync("git", ["init", "--quiet"], {cwd: dir, encoding: "utf8"});
    assert.equal(initialized.status, 0, initialized.stderr);
    const scan = () => spawnSync(process.execPath, [generator, "--check"], {cwd: dir, encoding: "utf8"});
    const clean = scan();
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /checked \d+ JVM member sources/);

    const path = "tooling/namespace-probe.ts";
    mkdirSync(dirname(join(dir, path)), {recursive: true});
    for (const [label, nul] of [["escaped", "\\u0000"], ["literal", String.fromCharCode(0)]]) {
      writeFileSync(join(dir, path), `const value = "${nul}";\n// ${model.prefix}\n`);
      const syntax = spawnSync(process.execPath, ["--check", path], {cwd: dir, encoding: "utf8"});
      assert.equal(syntax.status, 0, `${label}: source must be valid: ${syntax.stderr}`);
      const checked = scan();
      assert.equal(checked.status, 1, `${label}: reserved name in valid source must fail`);
      assert.match(checked.stderr, /reserved JVM member prefix outside its catalogue/);
      assert(checked.stderr.includes(path), checked.stderr);
      assert(!checked.stderr.includes("source is stale"), checked.stderr);
    }
    rmSync(join(dir, path));
    const unknown = "tooling/namespace-probe.data";
    writeFileSync(join(dir, unknown), `${String.fromCharCode(0)}${model.prefix}`);
    const data = scan();
    assert.equal(data.status, 1, "unknown NUL-bearing data must remain under exclusivity");
    assert(data.stderr.includes(unknown), data.stderr);
    rmSync(join(dir, unknown));
    const unknownJar = "tooling/namespace-probe.jar";
    writeFileSync(join(dir, unknownJar), Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]), Buffer.from(model.prefix),
    ]));
    const jar = scan();
    assert.equal(jar.status, 1, "an unknown ZIP-looking path is not a declared artifact");
    assert(jar.stderr.includes(unknownJar), jar.stderr);
    rmSync(join(dir, unknownJar));
    const restored = scan();
    assert.equal(restored.status, 0, restored.stderr);
    writeFileSync(join(dir, "runtime/jvm/nts-runtime.jar"), "not a ZIP archive");
    const corrupt = scan();
    assert.equal(corrupt.status, 1, "the declared artifact must have its actual format");
    assert.match(corrupt.stderr, /declared JVM runtime artifact is not a ZIP archive/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
