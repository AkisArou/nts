"use strict";

// Applicable public behavior from Node v24.20.0
// `test/parallel/test-os.js`. The middle block that coerces function objects
// through Symbol.toPrimitive is a section 13 non-goal; this retains every
// ordinary assertion on both sides of that block.
const assert = require("node:assert");
const hostProcess = require("node:process");
const path = require("node:path");
const { inspect } = require("node:util");
const os = require("node:os");

const isNumber = (value, key) => {
  assert(!Number.isNaN(value), `${key} should not be NaN`);
  assert.strictEqual(typeof value, "number");
};

hostProcess.env.TMPDIR = "/tmpdir";
hostProcess.env.TMP = "/tmp";
hostProcess.env.TEMP = "/temp";
if (hostProcess.platform === "win32") {
  assert.strictEqual(os.tmpdir(), "/temp");
  hostProcess.env.TEMP = "";
  assert.strictEqual(os.tmpdir(), "/tmp");
  hostProcess.env.TMP = "";
  const expected = `${hostProcess.env.SystemRoot || hostProcess.env.windir}\\temp`;
  assert.strictEqual(os.tmpdir(), expected);
  hostProcess.env.TEMP = "\\temp\\";
  assert.strictEqual(os.tmpdir(), "\\temp");
  hostProcess.env.TEMP = "\\tmpdir/";
  assert.strictEqual(os.tmpdir(), "\\tmpdir/");
  hostProcess.env.TEMP = "\\";
  assert.strictEqual(os.tmpdir(), "\\");
  hostProcess.env.TEMP = "C:\\";
  assert.strictEqual(os.tmpdir(), "C:\\");
} else {
  assert.strictEqual(os.tmpdir(), "/tmpdir");
  hostProcess.env.TMPDIR = "";
  assert.strictEqual(os.tmpdir(), "/tmp");
  hostProcess.env.TMP = "";
  assert.strictEqual(os.tmpdir(), "/temp");
  hostProcess.env.TEMP = "";
  assert.strictEqual(os.tmpdir(), "/tmp");
  hostProcess.env.TMPDIR = "/tmpdir/";
  assert.strictEqual(os.tmpdir(), "/tmpdir");
  hostProcess.env.TMPDIR = "/tmpdir\\";
  assert.strictEqual(os.tmpdir(), "/tmpdir\\");
  hostProcess.env.TMPDIR = "/";
  assert.strictEqual(os.tmpdir(), "/");
}

const endianness = os.endianness();
assert.strictEqual(typeof endianness, "string");
assert.match(endianness, /[BL]E/);

const hostname = os.hostname();
assert.strictEqual(typeof hostname, "string");
assert.ok(hostname.length > 0);

const type = os.type();
assert.strictEqual(typeof type, "string");
assert.ok(type.length > 0);
const isAIX = type === "AIX";
const isIBMi = type === "OS400";

if (!isIBMi) {
  const { PRIORITY_BELOW_NORMAL, PRIORITY_LOW } = os.constants.priority;
  const lowerPriority =
    os.getPriority() < PRIORITY_BELOW_NORMAL ? PRIORITY_BELOW_NORMAL : PRIORITY_LOW;
  os.setPriority(lowerPriority);
  const priority = os.getPriority();
  isNumber(priority, "priority");
  assert.strictEqual(priority, lowerPriority);
}

if (!isIBMi) {
  const uptime = os.uptime();
  isNumber(uptime, "uptime");
  assert.ok(uptime > 0);
}

const cpus = os.cpus();
assert.ok(Array.isArray(cpus));
assert.ok(cpus.length > 0);
for (const cpu of cpus) {
  assert.strictEqual(typeof cpu.model, "string");
  assert.strictEqual(typeof cpu.speed, "number");
  assert.strictEqual(typeof cpu.times.user, "number");
  assert.strictEqual(typeof cpu.times.nice, "number");
  assert.strictEqual(typeof cpu.times.sys, "number");
  assert.strictEqual(typeof cpu.times.idle, "number");
  assert.strictEqual(typeof cpu.times.irq, "number");
}

const release = os.release();
assert.strictEqual(typeof release, "string");
assert.ok(release.length > 0);
if (isAIX) assert.match(release, /^\d+\.\d+$/);

const platform = os.platform();
assert.strictEqual(typeof platform, "string");
assert.ok(platform.length > 0);

const arch = os.arch();
assert.strictEqual(typeof arch, "string");
assert.ok(arch.length > 0);

if (hostProcess.platform !== "sunos") {
  assert.ok(os.loadavg().length > 0);
  assert.ok(os.freemem() > 0);
  assert.ok(os.totalmem() > 0);
}

const interfaces = os.networkInterfaces();
switch (platform) {
  case "linux": {
    const actual = interfaces.lo.filter(
      (entry) => entry.address === "127.0.0.1" && entry.netmask === "255.0.0.0",
    );
    assert.deepStrictEqual(actual, [
      {
        address: "127.0.0.1",
        netmask: "255.0.0.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: true,
        cidr: "127.0.0.1/8",
      },
    ]);
    break;
  }
  case "win32": {
    const actual = interfaces["Loopback Pseudo-Interface 1"].filter(
      (entry) => entry.address === "127.0.0.1",
    );
    assert.deepStrictEqual(actual, [
      {
        address: "127.0.0.1",
        netmask: "255.0.0.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: true,
        cidr: "127.0.0.1/8",
      },
    ]);
    break;
  }
}

const netmaskToCIDRSuffix = new Map(
  Object.entries({
    "255.0.0.0": 8,
    "255.255.255.0": 24,
    "ffff:ffff:ffff:ffff::": 64,
    "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff": 128,
  }),
);
for (const value of Object.values(interfaces).flat(Infinity)) {
  assert.ok("cidr" in value, `"cidr" prop not found in ${inspect(value)}`);
  const suffix = netmaskToCIDRSuffix.get(value.netmask);
  if (suffix) assert.strictEqual(value.cidr, `${value.address}/${suffix}`);
}

assert.strictEqual(os.EOL, hostProcess.platform === "win32" ? "\r\n" : "\n");

const home = os.homedir();
assert.strictEqual(typeof home, "string");
assert.ok(home.includes(path.sep));

const version = os.version();
assert.strictEqual(typeof version, "string");
assert.ok(version.length > 0);

if (hostProcess.platform === "win32" && hostProcess.env.USERPROFILE) {
  assert.strictEqual(home, hostProcess.env.USERPROFILE);
  delete hostProcess.env.USERPROFILE;
  assert.ok(os.homedir().includes(path.sep));
  hostProcess.env.USERPROFILE = home;
} else if (hostProcess.platform !== "win32" && hostProcess.env.HOME) {
  assert.strictEqual(home, hostProcess.env.HOME);
  delete hostProcess.env.HOME;
  assert.ok(os.homedir().includes(path.sep));
  hostProcess.env.HOME = home;
}

const user = os.userInfo();
const userBuffer = os.userInfo({ encoding: "buffer" });
assert.strictEqual(typeof user, "object");
assert.notStrictEqual(user, null);

if (hostProcess.platform === "win32") {
  assert.strictEqual(user.uid, -1);
  assert.strictEqual(user.gid, -1);
  assert.strictEqual(user.shell, null);
  assert.strictEqual(userBuffer.uid, -1);
  assert.strictEqual(userBuffer.gid, -1);
  assert.strictEqual(userBuffer.shell, null);
} else {
  isNumber(user.uid, "uid");
  isNumber(user.gid, "gid");
  assert.strictEqual(typeof user.shell, "string");
  if (user.shell.length > 0) assert.ok(user.shell.includes(path.sep));
  assert.strictEqual(user.uid, userBuffer.uid);
  assert.strictEqual(user.gid, userBuffer.gid);
  assert.strictEqual(user.shell, userBuffer.shell.toString("utf8"));
}

assert.strictEqual(typeof user.username, "string");
assert.ok(user.homedir.includes(path.sep));
assert.strictEqual(user.username, userBuffer.username.toString("utf8"));
assert.strictEqual(user.homedir, userBuffer.homedir.toString("utf8"));

assert.strictEqual(os.devNull, hostProcess.platform === "win32" ? "\\\\.\\nul" : "/dev/null");
assert.ok(os.availableParallelism() > 0);
