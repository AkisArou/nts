// The bindings no lane can currently disagree with node about.
//
//   node tooling/conformance/standin-blindspot.mjs
//
// Two lanes run. Neither can see a wrong answer from these:
//
//   the interpreted lane calls a stand-in, and a stand-in that delegates to
//   node's own implementation -- `globalThis.nts_os_tmpdir = () => os.tmpdir()`
//   -- agrees with node by construction whatever the C does
//
//   the compiled lane would catch it, but only for a module that builds, and
//   most do not
//
// A binding that is *both* stubbed by delegation and unprobed is therefore
// unmeasured in the strict sense: no instrument in this tree is capable of
// reporting it wrong. That is a different and worse thing than "not yet
// checked", and it is worth a number that goes down.
//
// A delegating stand-in is not itself a defect -- it is how the interpreted lane
// runs at all, and rewriting them to reimplement node would only move the
// question. The answer is a probe, which reaches the real C without needing the
// module to compile. So this file exists to name the queue.

import { readFileSync, globSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");

// Node functions a stand-in delegates to. Listed rather than inferred: a body
// mentioning `os.` is not necessarily delegating, and a body that computes the
// answer itself is not blind even if it imports something.
const DELEGATES = new RegExp(
  "\\b[A-Za-z_][A-Za-z0-9_]*\\.(" + [
    "tmpdir", "hostname", "homedir", "cpus", "freemem", "totalmem", "uptime",
    "loadavg", "userInfo", "networkInterfaces", "arch", "platform", "release",
    "version", "type", "machine", "endianness", "EOL", "crc32", "deflateSync",
    "inflateSync", "gzipSync", "readFileSync", "writeFileSync", "statSync",
    "openSync", "closeSync", "realpathSync", "readlinkSync", "mkdirSync",
    "rmdirSync", "unlinkSync", "renameSync", "copyFileSync", "linkSync",
    "symlinkSync", "chmodSync", "chownSync", "utimesSync", "ftruncateSync",
    "fsyncSync", "accessSync", "mkdtempSync", "hrtime", "memoryUsage",
    "cpuUsage", "resourceUsage", "getgroups", "umask", "kill", "randomUUID",
  ].join("|") + ")\\b",
);

const standins = new Map();
const delegating = new Map();
for (const file of globSync(join(ROOT, "runtime/node/**/bindings.node.mjs")).sort()) {
  if (file.includes("node_modules")) continue;
  const text = readFileSync(file, "utf8");
  for (const chunk of text.split("globalThis.").slice(1)) {
    const m = /^(nts_[A-Za-z0-9_]+)/.exec(chunk);
    if (m === null) continue;
    const name = m[1];
    if (!standins.has(name)) standins.set(name, file);
    const body = chunk.split("\n").slice(0, 6).join("\n");
    if (DELEGATES.test(body) && !delegating.has(name)) {
      delegating.set(name, relative(ROOT, file));
    }
  }
}

const probed = new Set();
for (const file of globSync(join(ROOT, "tooling/conformance/probes/*.ts"))) {
  for (const m of readFileSync(file, "utf8").matchAll(/declare function (nts_[A-Za-z0-9_]+)/g)) {
    probed.add(m[1]);
  }
}

const blind = [...delegating.keys()].filter((n) => !probed.has(n)).sort();
console.log(`  ${standins.size} stand-in(s); ${delegating.size} delegate to node; ` +
  `${delegating.size - blind.length} of those are probed`);
console.log(`  ${blind.length} binding(s) no lane can disagree with node about`);
for (const name of blind) console.log(`      ${name.padEnd(32)} ${delegating.get(name)}`);
// Not a failure. This is a queue, and it should shrink rather than gate.
process.exitCode = 0;
