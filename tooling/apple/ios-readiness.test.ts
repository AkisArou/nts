// Black-box contracts for the Mac/simulator boundary; no VM or SDK required.
// NTS_TEST_IOS_RUNNER selects the saved old helper for the negative control.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const runner = process.env.NTS_TEST_IOS_RUNNER ?? fileURLToPath(new URL("./run-ios.sh", import.meta.url));
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;

function fixture(mode = "ok", initial = "Shutdown") {
  const cache = join(homedir(), ".cache", "nts-tests");
  mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(join(cache, "ios-readiness-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(dir, "state"), initial);
  const ssh = join(dir, "ssh.ts");
  writeFileSync(ssh, `
import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const command = args.slice(args.indexOf("test-mac") + 1).join(" ");
appendFileSync(process.env.TEST_EVENTS, JSON.stringify(["ssh", command]) + "\\n");
if (process.env.TEST_MODE === "no-mac") process.exit(255);
if (command === "true") process.exit(0);
if (command.startsWith("mktemp ")) { console.log(process.env.TEST_DIR + "/remote"); process.exit(0); }
if (command.startsWith("rm -rf ")) process.exit(0);
const child = spawnSync("bash", ["-c", command], { stdio: "inherit" });
process.exit(child.status ?? 1);
`);
  const xcrun = join(dir, "xcrun.ts");
  writeFileSync(xcrun, `
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.TEST_EVENTS, JSON.stringify(["xcrun", ...args]) + "\\n");
const mode = process.env.TEST_MODE;
if (args[1] === "bootstatus") {
  if (mode === "boot-fails") { console.error("simulator boot failed"); process.exit(149); }
  if (mode === "missing") { console.error("Invalid device: " + args[2]); process.exit(148); }
  if (mode === "boot-77") process.exit(77);
  if (mode === "boot-timeout") await new Promise((resolve) => setTimeout(resolve, 60_000));
  if (mode === "slow-ready") await new Promise((resolve) => setTimeout(resolve, 1_200));
  writeFileSync(process.env.TEST_DIR + "/state", "Booted");
  console.log("Device is Booted");
} else {
  if (readFileSync(process.env.TEST_DIR + "/state", "utf8") !== "Booted") process.exit(19);
  if (args[1] === "install" && mode === "install-fails") process.exit(17);
  if (args[1] === "launch") {
    console.log("dev.nts.test: 123");
    if (mode === "app-timeout") await new Promise((resolve) => setTimeout(resolve, 60_000));
    console.log("golden application output");
    console.error("application diagnostic");
    process.exit(mode === "app-fails" ? 7 : 0);
  }
}
`);
  for (const [name, body] of [
    ["ssh", `exec ${quote(process.execPath)} ${quote(ssh)} "$@"`],
    ["xcrun", `exec ${quote(process.execPath)} ${quote(xcrun)} "$@"`],
    ["scp", "exit 0"],
  ]) {
    const path = join(bin, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
  }
  const bundle = join(dir, "Fixture.app");
  mkdirSync(bundle);
  writeFileSync(join(bundle, "Info.plist"), "<key>CFBundleIdentifier</key>\n<string>dev.nts.test</string>\n");
  return {
    bundle,
    state: () => readFileSync(join(dir, "state"), "utf8"),
    events: () => readFileSync(join(dir, "events"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]),
    run: (args = ["--reachable"], extra: Record<string, string> = {}) => spawnSync("bash", [runner, ...args], {
      encoding: "utf8", timeout: 8_000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, XDG_CACHE_HOME: dir,
        NTS_APPLE_SSH: "test-mac", NTS_IOS_DEVICE: "Test Phone", TEST_DIR: dir,
        TEST_EVENTS: join(dir, "events"), TEST_MODE: mode, ...extra },
    }),
    clean: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("a cold configured simulator is ready before reachability succeeds", () => {
  const f = fixture();
  try {
    const p = f.run();
    assert.equal(p.status, 0, p.stderr);
    assert.equal(f.state(), "Booted");
    assert.equal(p.stdout, "");
    assert.match(p.stderr, /run-ios: readiness .*exit 0/);
    assert.ok(f.events().some((e) => e[0] === "xcrun" && e[2] === "bootstatus" && e[3] === "Test Phone"));
  } finally { f.clean(); }
});

test("warm readiness is idempotent, including a device name with quotes", () => {
  const f = fixture("ok", "Booted");
  try {
    for (let i = 0; i < 2; i++) assert.equal(f.run(undefined, { NTS_IOS_DEVICE: "Owner's Phone" }).status, 0);
    assert.equal(f.state(), "Booted");
    assert.equal(f.events().filter((e) => e[0] === "xcrun" && e[3] === "Owner's Phone").length, 2);
  } finally { f.clean(); }
});

for (const mode of ["missing", "boot-fails", "boot-77", "boot-timeout"]) {
  test(`${mode} is a named failure, never a no-Mac skip`, () => {
    const f = fixture(mode);
    try {
      const p = f.run(undefined, { NTS_IOS_READY_TIMEOUT: "1" });
      assert.equal(p.status, mode === "boot-timeout" ? 124 : 1, p.stderr);
      assert.match(p.stderr, /configured simulator 'Test Phone' did not become ready/);
      assert.equal(f.state(), "Shutdown");
    } finally { f.clean(); }
  });
}

test("an unreachable Mac is the sole 77 control and never tries to boot", () => {
  const f = fixture("no-mac");
  try {
    assert.equal(f.run().status, 77);
    assert.ok(f.events().every((e) => e[0] === "ssh"));
  } finally { f.clean(); }
});

test("readiness does not consume the application budget", () => {
  const f = fixture("slow-ready");
  try {
    const p = f.run([f.bundle], { NTS_IOS_READY_TIMEOUT: "4", NTS_IOS_TIMEOUT: "1" });
    assert.equal(p.status, 0, p.stderr);
    assert.equal(p.stdout, "golden application output\n");
  } finally { f.clean(); }
});

test("an application still times out under its own unchanged budget", () => {
  const f = fixture("app-timeout");
  try {
    const p = f.run([f.bundle], { NTS_IOS_TIMEOUT: "1" });
    assert.equal(p.status, 124, p.stderr);
    assert.match(p.stderr, /did not finish dev\.nts\.test in 1 s \(NTS_IOS_TIMEOUT\)/);
  } finally { f.clean(); }
});

for (const mode of ["ok", "install-fails", "app-fails", "boot-fails"] as const) {
  test(`direct artifact: ${mode} preserves output, ordering and exit status`, () => {
    const f = fixture(mode);
    try {
      const p = f.run([f.bundle]);
      assert.equal(p.status, ({ ok: 0, "install-fails": 17, "app-fails": 7, "boot-fails": 1 })[mode], p.stderr);
      const events = f.events().filter((e) => e[0] === "xcrun").map((e) => e[2]);
      assert.deepEqual(events, mode === "boot-fails" ? ["bootstatus"] :
        mode === "install-fails" ? ["bootstatus", "install"] : ["bootstatus", "install", "launch"]);
      assert.equal(p.stdout, mode === "ok" || mode === "app-fails" ? "golden application output\n" : "");
      if (mode === "ok" || mode === "app-fails") {
        assert.match(p.stderr, /run-ios: install begin[\s\S]*real [0-9]/);
        assert.match(p.stderr, /run-ios: launch-and-app begin[\s\S]*real [0-9]/);
        assert.match(p.stderr, /application diagnostic/);
      }
    } finally { f.clean(); }
  });
}
