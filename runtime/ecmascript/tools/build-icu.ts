// Build the exact native source pin; never substitutes a platform ICU version.
// node runtime/ecmascript/tools/build-icu.ts [--jobs N]
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const out = resolve(root, "target/ecmascript/icu-native-pin");
const manifest = JSON.parse(
  readFileSync(resolve(root, "runtime/ecmascript/providers/icu/artifacts.json"), "utf8"),
) as { nativeSource: { url: string; sha256: string } };
const pin = manifest.nativeSource;
const jobsIndex = process.argv.indexOf("--jobs");
const jobs = jobsIndex < 0 ? 4 : Number(process.argv[jobsIndex + 1]);
if (!Number.isInteger(jobs) || jobs < 1) throw new Error("--jobs requires a positive integer");
mkdirSync(out, { recursive: true });
const archive = resolve(out, "icu-sources.tgz");
if (!existsSync(archive)) {
  const response = await fetch(pin.url);
  if (!response.ok) throw new Error(`ICU4C download: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== pin.sha256)
    throw new Error("ICU4C download hash mismatch");
  writeFileSync(archive, bytes);
}
if (createHash("sha256").update(readFileSync(archive)).digest("hex") !== pin.sha256)
  throw new Error("ICU4C cached source hash mismatch");

function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(command + " failed:\n" + result.stdout + result.stderr);
}
run("tar", ["-xzf", archive, "-C", out], root);
const build = resolve(out, "build");
const prefix = resolve(out, "install");
mkdirSync(build, { recursive: true });
console.log("Configuring pinned ICU4C with full locale data and static libraries");
run(
  resolve(out, "icu/source/configure"),
  [
    "--prefix=" + prefix,
    "--disable-shared",
    "--enable-static",
    "--disable-tests",
    "--disable-samples",
    "--with-data-packaging=static",
    "CFLAGS=-O2 -fPIC",
    "CXXFLAGS=-O2 -fPIC -std=c++17",
  ],
  build,
);
console.log("Building pinned ICU4C");
run("make", ["-j" + jobs], build);
run("make", ["install"], build);
console.log(
  JSON.stringify({
    mode: "pinned-ICU4C",
    sha256: pin.sha256,
    prefix,
    pkgConfigLibdir: resolve(prefix, "lib/pkgconfig"),
  }),
);
