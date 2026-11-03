import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {test} from "node:test";
import {gateSteps, interopOwed, owed} from "../gate/owed.mjs";
import names from "../../compiler/codegen/jvm/generated-members.json" with {type: "json"};

const root = fileURLToPath(new URL("../../", import.meta.url));
const reach = (rules: ReturnType<typeof owed>) => new Set([
  ...gateSteps(rules), ...rules.flatMap(rule => rule.steps),
]);

test("fixed JVM callers retain their actual stock reader coverage", () => {
  for (const added of [false, true]) {
    const lookup = owed([{path: "tooling/jvm/member-name.ts", added}]);
    assert.ok(!lookup.some(rule => rule.full), "the lookup has real readers");
    for (const step of ["tests", "on-device", "interop"]) assert.ok(reach(lookup).has(step));
    assert.equal(interopOwed(lookup), "all", "retain the stock reader graph's conservative scope");
    const initializer = owed([{path: "tooling/android/module-initializer.sh", added}]);
    assert.ok(!initializer.some(rule => rule.full), "the initializer has real callers");
    for (const step of ["tests", "on-device"]) assert.ok(reach(initializer).has(step));
    assert.equal(interopOwed(initializer), null);
    // The compiler's embedded-input relation can additionally owe the JVM
    // crate's backend consumers. Preserve those additive stock facts too.
  }
  const unknown = ["tooling", "jvm", `unplaced-member-${process.pid}.ts`].join("/");
  assert.ok(owed([{path: unknown, added: true}]).some(rule => rule.full));
});

test("a fixed role lookup does not admit an unregistered key", () => {
  const invoke = (...args: string[]) => spawnSync(process.execPath,
    ["tooling/jvm/member-name.ts", ...args], {cwd: root, encoding: "utf8"});
  const valid = invoke("MODULE_INIT");
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stdout, names.fixed.MODULE_INIT + "\n");
  for (const args of [["__proto__"], ["MODULE_INIT", "anotherName"]]) {
    const invalid = invoke(...args);
    assert.notEqual(invalid.status, 0);
    assert.equal(invalid.stdout, "");
    assert.match(invalid.stderr, /usage: member-name\.ts/);
  }
});
