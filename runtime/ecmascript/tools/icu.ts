// Reproducible provider/ABI validation, independent of the Java-8 core runtime.
// node runtime/ecmascript/tools/icu.ts [--regenerate-bindings] [--sanitize]
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const provider = resolve(root, "runtime/ecmascript/providers/icu");
const out = resolve(root, "target/ecmascript/icu-check");
const fixture = resolve(root, "tooling/conformance/ecmascript/icu-compiled");
const nts = process.env.NTS_BIN ?? resolve(root, "target/release/nts");
const env: NodeJS.ProcessEnv = {
  ...process.env,
  NTS_TSGO: process.env.NTS_TSGO ?? resolve(root, "target/tsgo"),
};
for (const option of process.argv.slice(2)) {
  if (!["--pinned-native", "--regenerate-bindings", "--sanitize", "--bench", "--android"].includes(option)) throw new Error("Unknown option: " + option);
}
if (process.argv.includes("--pinned-native")) {
  env.PKG_CONFIG_LIBDIR = resolve(root, "target/ecmascript/icu-native-pin/install/lib/pkgconfig");
}
mkdirSync(out, { recursive: true });

function run(binary: string, args: string[], cwd = root): string {
  const result = spawnSync(binary, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const diagnostics = result.stdout + result.stderr;
  if (
    result.status !== 0 ||
    /\bNTS\d{4}\b|runtime error:|ERROR: (AddressSanitizer|LeakSanitizer)/.test(diagnostics)
  )
    throw new Error(`${binary} failed or refused an operation:\n${diagnostics}`);
  return result.stdout.trim();
}
function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Read the same exact Maven pin that the ordinary NTS dependency resolver can
// consume. A corrupt cached jar fails, and an unverified download is never used.
const pins = readFileSync(resolve(provider, "dependencies.tsv"), "utf8")
  .split("\n")
  .filter((line) => line.length > 0 && !line.startsWith("#"));
if (pins.length !== 1) throw new Error("Expected exactly the ICU4J runtime pin");
const [group, artifact, version, sha256, , scope, repository] = pins[0]!.split("\t");
if (!group || !artifact || !version || !sha256 || scope !== "runtime" || !repository)
  throw new Error("Invalid ICU4J pin");
const jar = resolve(out, `${artifact}-${version}.jar`);
if (!existsSync(jar)) {
  const url = `${repository}/${group.replaceAll(".", "/")}/${artifact}/${version}/${artifact}-${version}.jar`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`ICU4J download: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (hash(bytes) !== sha256) throw new Error("ICU4J download hash mismatch");
  writeFileSync(jar, bytes);
}
if (hash(readFileSync(jar)) !== sha256) throw new Error("ICU4J cached jar hash mismatch");
const artifacts = JSON.parse(readFileSync(resolve(provider, "artifacts.json"), "utf8")) as {
  license: { sha256: string };
};
if (
  hash(readFileSync(resolve(root, "runtime/ecmascript/third_party/ICU-LICENSE"))) !==
  artifacts.license.sha256
)
  throw new Error("ICU license drift");

const java = resolve(out, "java");
mkdirSync(java, { recursive: true });
const sources = readdirSync(resolve(provider, "java/nts/intl"))
  .filter((name) => name.endsWith(".java"))
  .map((name) => resolve(provider, "java/nts/intl", name));
run("javac", ["--release", "11", "-cp", jar, "-d", java, ...sources]);
const generated = resolve(out, "bindings");
run(nts, [
  "bind",
  "--classes",
  java,
  "--package",
  "nts.intl",
  "--out",
  generated,
  "--overrides",
  resolve(provider, "java/overrides.json"),
]);
for (const name of ["nts.intl.d.ts", "nts.intl.bind"]) {
  const bytes = readFileSync(resolve(generated, name));
  const committed = resolve(provider, "java/types", name);
  if (process.argv.includes("--regenerate-bindings")) writeFileSync(committed, bytes);
  else if (!bytes.equals(readFileSync(committed))) throw new Error("Java binding drift: " + name);
}

const jvm = resolve(out, "jvm");
run(nts, ["emit-jvm", resolve(fixture, "tsconfig.jvm.json"), "--out", jvm]);
const classpath = [jvm, resolve(jvm, "nts-runtime.jar"), java, jar].join(
  process.platform === "win32" ? ";" : ":",
);
run("javac", ["--release", "11", "-cp", classpath, "-d", jvm, resolve(fixture, "Drive.java")]);
const jvmResult = run("java", ["-Xverify:all", "-cp", classpath, "Drive"]);

const native = resolve(out, "native");
run(nts, ["emit-c", resolve(fixture, "tsconfig.c.json"), "--rc", "--out", native]);
const cc = process.env.CC ?? "clang";
const cflags = run("pkg-config", ["--cflags", "icu-i18n", "icu-uc"]).split(/\s+/).filter(Boolean);
const libs = run("pkg-config", ["--static", "--libs", "icu-i18n", "icu-uc"])
  .split(/\s+/)
  .filter(Boolean);
// Provider code is checked with strict warnings separately from the compiler's
// emitted code and the existing runtime/vendor sources.
const object = resolve(native, "nts_icu.o");
run(cc, [
  "-std=c11",
  "-Wall",
  "-Wextra",
  "-Werror",
  ...cflags,
  "-I" + resolve(root, "runtime/c"),
  "-c",
  resolve(provider, "c/nts_icu.c"),
  "-o",
  object,
]);
const executable = resolve(native, "drive");
const sanitize = process.argv.includes("--sanitize")
  ? ["-fsanitize=address,undefined", "-fno-omit-frame-pointer"]
  : [];
const objects: string[] = [];
for (const [name, source] of [
  ["program", resolve(native, "program.c")],
  ["runtime", resolve(root, "runtime/c/nts_runtime.c")],
  ["unicode", resolve(root, "runtime/c/nts_unicode.c")],
  ["provider", resolve(provider, "c/nts_icu.c")],
  ["drive", resolve(fixture, "drive.c")],
] as const) {
  const object = resolve(native, name + ".o");
  run(cc, ["-std=c11", "-O2", "-D_GNU_SOURCE", "-DNTS_PROVIDER_RC", ...sanitize, ...cflags,
    "-I" + native, "-I" + resolve(root, "runtime/c"), "-I" + resolve(provider, "c"), "-c", source, "-o", object]);
  objects.push(object);
}
// ICU's implementation uses C++; its C ABI does not remove the need to link
// the C++ standard library when consuming a static build. Compile NTS as C,
// then use the C++ driver for the final link so the platform selects that ABI.
run(process.env.CXX ?? "clang++", [...sanitize, ...objects, ...libs, "-lm", "-o", executable]);
const cResult = run(executable, []);
const expected =
  "America/New_York:-18000000:1710055800000:1730611800000:1710054000000\n900,719,925,474,099,312,345.00;minusSign=-;integer=12;group=,;integer=345;decimal=.;fraction=678\n𝟗𝟎𝟎,𝟕𝟏𝟗,𝟗𝟐𝟓,𝟒𝟕𝟒,𝟎𝟗𝟗,𝟑𝟏𝟐,𝟑𝟒𝟓.𝟎𝟎;minusSign=-;integer=𝟏𝟐;group=,;integer=𝟑𝟒𝟓;decimal=.;fraction=𝟔𝟕𝟖";
if (jvmResult !== expected || cResult !== expected)
  throw new Error("ICU compiled ABI mismatch:\nC: " + cResult + "\nJVM: " + jvmResult);
console.log(
  JSON.stringify({
    mode: "compiled-ICU-ABI",
    icu: version,
    backends: ["c-rc", "jvm"],
    exactDecimal: true,
    utf16Parts: true,
    dst: true,
    sanitize: sanitize.length > 0,
  }),
);
if (process.argv.includes("--bench")) {
  console.log(run(executable, ["50000"]));
  console.log(run("java", ["-Xverify:all", "-cp", classpath, "Drive", "50000"]));
}
if (process.argv.includes("--android")) {
  const sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error("--android requires ANDROID_HOME or ANDROID_SDK_ROOT");
  const androidJar = resolve(sdk, "platforms/android-29/android.jar");
  if (!existsSync(androidJar)) throw new Error("--android requires the API 29 platform");
  const tools = readdirSync(resolve(sdk, "build-tools")).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const newest = tools[tools.length - 1];
  if (!newest) throw new Error("--android requires Android build-tools");
  const adapterJar = resolve(out, "adapter.jar");
  const programJar = resolve(out, "program.jar");
  run("jar", ["--create", "--file", adapterJar, "-C", java, "."]);
  run("jar", ["--create", "--file", programJar, "-C", jvm, "nts", "-C", jvm, "Drive.class"]);
  const dex = resolve(out, "dex");
  rmSync(dex, { force: true, recursive: true });
  mkdirSync(dex, { recursive: true });
  run(resolve(sdk, "build-tools", newest, "d8"), ["--release", "--min-api", "29", "--lib", androidJar, "--output", dex, adapterJar, programJar, resolve(jvm, "nts-runtime.jar"), jar]);
  // D8 emits code only. ICU classpath resources must travel with that code.
  const resources = resolve(out, "android-resources");
  rmSync(resources, { force: true, recursive: true });
  mkdirSync(resources, { recursive: true });
  run("jar", ["--extract", "--file", jar], resources);
  function removeBytecode(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) removeBytecode(path);
      else if (entry.name.endsWith(".class") || /\.(SF|RSA|DSA)$/.test(entry.name)) rmSync(path);
    }
  }
  removeBytecode(resources);
  rmSync(resolve(resources, "META-INF/MANIFEST.MF"), { force: true });
  mkdirSync(resolve(resources, "META-INF"), { recursive: true });
  writeFileSync(resolve(resources, "META-INF/ICU-LICENSE"), readFileSync(resolve(root, "runtime/ecmascript/third_party/ICU-LICENSE")));
  const artifact = resolve(out, "nts-icu-android-probe.jar");
  run("jar", ["--create", "--file", artifact, "-C", dex, ".", "-C", resources, "."]);
  const entries = run("jar", ["--list", "--file", artifact]).split("\n");
  if (!entries.includes("classes.dex") || !entries.some((name) => name.endsWith("/zoneinfo64.res")) || entries.some((name) => name.endsWith(".class"))) throw new Error("Android probe is missing dex/data or still contains JVM bytecode");
  console.log(JSON.stringify({ mode: "ICU-Android-dex-and-resources", minApi: 29, bytes: statSync(artifact).size, artifact, deviceExecution: false }));
}
