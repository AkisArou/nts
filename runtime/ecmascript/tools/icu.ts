// Reproducible provider/ABI validation, independent of the Java-8 core runtime.
// node runtime/ecmascript/tools/icu.ts [--regenerate-bindings] [--all-backends] [--sanitize]
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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
  if (
    ![
      "--pinned-native",
      "--regenerate-bindings",
      "--sanitize",
      "--bench",
      "--android",
      "--all-backends",
    ].includes(option)
  )
    throw new Error("Unknown option: " + option);
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
mkdirSync(native, { recursive: true });
const cc = process.env.CC ?? "clang";
const cxx = process.env.CXX ?? "clang++";
const cflags = run("pkg-config", ["--cflags", "icu-i18n", "icu-uc"]).split(/\s+/).filter(Boolean);
const libs = run("pkg-config", ["--static", "--libs", "icu-i18n", "icu-uc"])
  .split(/\s+/)
  .filter(Boolean);
const sanitize = process.argv.includes("--sanitize")
  ? ["-fsanitize=address,undefined", "-fno-omit-frame-pointer"]
  : [];
// The provider ABI and Unicode source do not depend on the memory mode. Build
// them once; each backend links its own emitted program and runtime mode.
const providerObjects: string[] = [];
for (const [name, source] of [
  ["unicode", resolve(root, "runtime/c/nts_unicode.c")],
  ["provider", resolve(provider, "c/nts_icu.c")],
  ["collator", resolve(provider, "c/nts_icu_collator.c")],
  ["relative", resolve(provider, "c/nts_icu_relative.c")],
] as const) {
  const object = resolve(native, name + ".o");
  run(cc, [
    "-std=c11",
    "-O2",
    "-D_GNU_SOURCE",
    ...(name === "unicode" ? [] : ["-Wall", "-Wextra", "-Werror"]),
    ...sanitize,
    ...cflags,
    "-I" + resolve(root, "runtime/c"),
    "-I" + resolve(provider, "c"),
    "-c",
    source,
    "-o",
    object,
  ]);
  providerObjects.push(object);
}
for (const name of ["locale", "number_range", "date_pattern", "date", "plural"]) {
  const object = resolve(native, name + ".o");
  run(cxx, [
    "-std=c++17",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    ...sanitize,
    ...cflags,
    "-I" + resolve(root, "runtime/c"),
    "-I" + resolve(provider, "c"),
    "-c",
    resolve(provider, "c/nts_icu_" + name + ".cpp"),
    "-o",
    object,
  ]);
  providerObjects.push(object);
}
function buildNative(
  backend: "c" | "llvm",
  rc: boolean,
): { executable: string; result: string; backend: string } {
  const name = backend + (rc ? "-rc" : "");
  const directory = backend === "c" && rc ? native : resolve(out, "native-" + name);
  mkdirSync(directory, { recursive: true });
  const program = resolve(directory, backend === "c" ? "program.c" : "program.ll");
  if (backend === "c")
    run(nts, [
      "emit-c",
      resolve(fixture, "tsconfig.c.json"),
      ...(rc ? ["--rc"] : []),
      "--out",
      directory,
    ]);
  else
    writeFileSync(
      program,
      run(nts, ["emit-llvm", resolve(fixture, "tsconfig.c.json"), ...(rc ? ["--rc"] : [])]),
    );
  const objects = [...providerObjects];
  for (const [file, input] of [
    ["program", program],
    ["runtime", resolve(root, "runtime/c/nts_runtime.c")],
    ["drive", resolve(fixture, "drive.c")],
  ] as const) {
    const object = resolve(directory, file + ".o");
    run(cc, [
      "-O2",
      ...(file === "program" && backend === "llvm"
        ? []
        : ["-std=c11", "-D_GNU_SOURCE", ...(rc ? ["-DNTS_PROVIDER_RC"] : [])]),
      ...sanitize,
      ...cflags,
      // LLVM exports the same C ABI; the driver uses only export declarations
      // from C's generated header, never its generated class layouts or body.
      "-I" + (backend === "c" ? directory : native),
      "-I" + resolve(root, "runtime/c"),
      "-I" + resolve(provider, "c"),
      "-c",
      input,
      "-o",
      object,
    ]);
    objects.push(object);
  }
  const executable = resolve(directory, "drive");
  // ICU's C ABI still needs the platform's C++ runtime for static linking.
  run(cxx, [...sanitize, ...objects, ...libs, "-lm", "-o", executable]);
  return { executable, result: run(executable, []), backend: name };
}
const primary = buildNative("c", true);
const executable = primary.executable;
const nativeResults = [primary];
if (process.argv.includes("--all-backends")) {
  nativeResults.push(buildNative("c", false));
  nativeResults.push(buildNative("llvm", true));
  nativeResults.push(buildNative("llvm", false));
}
let expected =
  "America/New_York:-18000000:1710055800000:1730611800000:1710054000000\n900,719,925,474,099,312,345.00;minusSign=-;integer=12;group=,;integer=345;decimal=.;fraction=678\n𝟗𝟎𝟎,𝟕𝟏𝟗,𝟗𝟐𝟓,𝟒𝟕𝟒,𝟎𝟗𝟗,𝟑𝟏𝟐,𝟑𝟒𝟓.𝟎𝟎;minusSign=-;integer=𝟏𝟐;group=,;integer=𝟑𝟒𝟓;decimal=.;fraction=𝟔𝟕𝟖\n+1.3%\n($1.05)\n¥1,235\nKWD 1.235\n1.2K\n12.4 meters per second\n001\n13\n0.10\nZZZ 1.23\n~$1;currency=$=startRange;integer=3=startRange;literal= – =shared;currency=$=endRange;integer=5=endRange\n1:2:~0\n987,654,321,987,654,321–987,654,321,987,654,322\nbuddhist,gregory;standard,phonebk,search,emoji,eor;h12;h23;Asia/Tokyo;521;522;1;0;-1";
expected += "\n3:7:0:0:-1:-1:0:-1:-1:-1:-1";
expected +=
  "\nyMMMMdHHmmssSSSv:numeric:long:numeric:2-digit:2-digit:2-digit:3:shortGeneric:h24:2-digit:h12:numeric:long:numeric";
expected +=
  "\n2024-03-10 03:30:00.000 😀 EDT;year=1969;literal=-;month=12;literal=-;day=31;literal= ;hour=19;literal=:;minute=00;literal=:;second=00;literal=.;fractionalSecond=000;literal= 😀 ;timeZoneName=EST";
expected += "\n1582-10-10 AD:0001-01-01 BC:271822-04-20 BC:275760-09-13 AD";
expected += "\n𝟏𝟗𝟕𝟎-𝟎𝟏-𝟎𝟏;year=𝟏𝟗𝟕𝟎;literal=-;month=𝟎𝟏;literal=-;day=𝟎𝟏";
expected +=
  "\n2019(ji-hai) First Month 1;relatedYear=2019;literal=(;yearName=ji-hai;literal=) ;month=First Month;literal= ;day=1";
expected +=
  "\nJan 1 – 3, 1970;month=Jan=shared;literal= =shared;day=1=startRange;literal= – =shared;day=3=endRange;literal=, =shared;year=1970=shared";
expected +=
  "\nJan 1, 1970;month=Jan=shared;literal= =shared;day=1=shared;literal=, =shared;year=1970=shared";
expected += "\nAmerica/New_York:true:true:-04:00:+05:30:+00:00";
expected += "\nA, , and B;element=2;literal=2;element=0;literal=6;element=1";
expected += "\nA e iglesia:A y hielo:A u 11:A o 110\nA וב:A ו-😀\nA, B, C, D rānei";
expected += "\n0 days ago:in 0 days:today:in 0.001 days:in 0.999 days";
expected +=
  "\nin 1,234.5 days;literal=in ;integer=1=day;group=,=day;integer=234=day;decimal=.=day;fraction=5=day;literal= days";
expected += "\nza 1000 dni\nin 𝟏𝟐.𝟓 days;0=3:7;2=7:8;1=8:10";
expected += "\none,other:one:one:other:one:other";
expected += "\none,two,few,other:other:one:two:few:other:other:one:one:other";
expected += "\nother:one\none:few\nmany:many:one\none:other:one\nother:other";
if (jvmResult !== expected) throw new Error("ICU compiled ABI mismatch on JVM:\n" + jvmResult);
for (const result of nativeResults)
  if (result.result !== expected)
    throw new Error("ICU compiled ABI mismatch on " + result.backend + ":\n" + result.result);
console.log(
  JSON.stringify({
    mode: "compiled-ICU-ABI",
    icu: version,
    backends: [...nativeResults.map((result) => result.backend), "jvm"],
    exactDecimal: true,
    utf16Parts: true,
    dst: true,
    numberOptions: true,
    numberRanges: true,
    localeData: true,
    collation: true,
    datePatterns: true,
    dateText: true,
    dateRanges: true,
    timeZoneIdentifiers: true,
    listPatterns: true,
    relativeTime: true,
    pluralRules: true,
    sanitize: sanitize.length > 0,
  }),
);
if (process.argv.includes("--bench")) {
  for (const mode of ["scalar", "range"]) {
    const arguments_ = [mode === "scalar" ? "500000" : "100000", "plural", mode];
    console.log(run(executable, arguments_));
    console.log(run("java", ["-Xverify:all", "-cp", classpath, "Drive", ...arguments_]));
  }
  console.log(run(executable, ["50000"]));
  console.log(run("java", ["-Xverify:all", "-cp", classpath, "Drive", "50000"]));
  for (const count of [3, 100, 1000]) {
    const iterations = count === 3 ? "50000" : "2000";
    console.log(run(executable, [iterations, String(count)]));
    console.log(
      run("java", ["-Xverify:all", "-cp", classpath, "Drive", iterations, String(count)]),
    );
  }
}
if (process.argv.includes("--android")) {
  const sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error("--android requires ANDROID_HOME or ANDROID_SDK_ROOT");
  const androidJar = resolve(sdk, "platforms/android-29/android.jar");
  if (!existsSync(androidJar)) throw new Error("--android requires the API 29 platform");
  const tools = readdirSync(resolve(sdk, "build-tools")).sort((a, b) =>
    a.localeCompare(b, "en", { numeric: true }),
  );
  const newest = tools[tools.length - 1];
  if (!newest) throw new Error("--android requires Android build-tools");
  const adapterJar = resolve(out, "adapter.jar");
  const programJar = resolve(out, "program.jar");
  run("jar", ["--create", "--file", adapterJar, "-C", java, "."]);
  run("jar", ["--create", "--file", programJar, "-C", jvm, "nts", "-C", jvm, "Drive.class"]);
  const dex = resolve(out, "dex");
  rmSync(dex, { force: true, recursive: true });
  mkdirSync(dex, { recursive: true });
  run(resolve(sdk, "build-tools", newest, "d8"), [
    "--release",
    "--min-api",
    "29",
    "--lib",
    androidJar,
    "--output",
    dex,
    adapterJar,
    programJar,
    resolve(jvm, "nts-runtime.jar"),
    jar,
  ]);
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
  writeFileSync(
    resolve(resources, "META-INF/ICU-LICENSE"),
    readFileSync(resolve(root, "runtime/ecmascript/third_party/ICU-LICENSE")),
  );
  const artifact = resolve(out, "nts-icu-android-probe.jar");
  run("jar", ["--create", "--file", artifact, "-C", dex, ".", "-C", resources, "."]);
  const entries = run("jar", ["--list", "--file", artifact]).split("\n");
  if (
    !entries.includes("classes.dex") ||
    !entries.some((name) => name.endsWith("/zoneinfo64.res")) ||
    entries.some((name) => name.endsWith(".class"))
  )
    throw new Error("Android probe is missing dex/data or still contains JVM bytecode");
  console.log(
    JSON.stringify({
      mode: "ICU-Android-dex-and-resources",
      minApi: 29,
      bytes: statSync(artifact).size,
      artifact,
      deviceExecution: false,
    }),
  );
}
