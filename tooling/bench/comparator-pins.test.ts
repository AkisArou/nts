import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { pinnedComparators, sha256 } from "./comparator-pins.ts";
const declaration = JSON.parse(
  readFileSync(new URL("./comparators.json", import.meta.url), "utf8"),
);
function fixture() {
  const parent = join(homedir(), ".cache/nts-tmp");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "comparator-pin-test-")),
    cache = join(root, "cache");
  mkdirSync(join(root, "tooling/bench"), { recursive: true });
  mkdirSync(cache);
  const pin = structuredClone(declaration);
  pin.node = process.version;
  return {
    root,
    cache,
    pin,
    save() {
      writeFileSync(join(root, "tooling/bench/comparators.json"), JSON.stringify(pin));
    },
  };
}
test("missing pinned artifacts are visible absences, with no PATH fallback", () => {
  const f = fixture();
  try {
    f.save();
    const pins = pinnedComparators(f.root, f.cache);
    assert.equal(pins.bun, null);
    assert.equal(pins.scriptc, null);
    assert.equal(pins.builds["Bun AOT"]?.commit, declaration.bun.commit);
    assert.deepEqual(pins.builds.node?.command, [process.execPath]);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test("a checksum mismatch or escaping artifact path refuses by name", () => {
  const f = fixture();
  try {
    f.pin.bun.path = "bun";
    writeFileSync(join(f.cache, "bun"), "wrong bytes");
    f.save();
    assert.throws(() => pinnedComparators(f.root, f.cache), /checksum mismatch.*bun/);
    f.pin.bun.path = "../outside";
    f.save();
    assert.throws(() => pinnedComparators(f.root, f.cache), /escapes cache/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test("both Bun columns resolve the exact same checked artifact", () => {
  const f = fixture();
  try {
    f.pin.bun.path = "bun";
    writeFileSync(join(f.cache, "bun"), "artifact");
    f.pin.bun.sha256 = sha256(join(f.cache, "bun"));
    f.save();
    const pins = pinnedComparators(f.root, f.cache);
    assert.equal(pins.bun, join(f.cache, "bun"));
    assert.equal(pins.builds["Bun AOT"]?.sha256, pins.builds["Bun JIT"]?.sha256);
    assert.ok(pins.builds["Bun AOT"]?.command.includes("--aot"));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
