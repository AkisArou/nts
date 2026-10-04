// Reproducible provider/ABI validation, independent of the Java-8 core runtime.
// node runtime/ecmascript/tools/icu.ts [--regenerate-bindings] [--all-backends] [--sanitize] [--duration|--calendar|--date-fields]
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
import {
  calendarCases,
  calendarIdentifiers,
  calendarTableCases,
} from "../../../tooling/conformance/ecmascript/icu-compiled/calendar-cases.ts";

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
      "--duration",
      "--calendar",
      "--date-fields",
    ].includes(option)
  )
    throw new Error("Unknown option: " + option);
}
const duration = process.argv.includes("--duration");
const calendar = process.argv.includes("--calendar");
const dateFields = process.argv.includes("--date-fields");
if (Number(duration) + Number(calendar) + Number(dateFields) > 1)
  throw new Error("Choose one ICU witness: --duration, --calendar or --date-fields");
if (
  (duration || calendar || dateFields) &&
  (process.argv.includes("--bench") || process.argv.includes("--android"))
)
  throw new Error(
    "This ICU witness uses its own driver; run benchmarks/Android on the general fixture",
  );
const configuration = calendar
  ? "tsconfig.calendar-data."
  : duration
    ? "tsconfig.duration."
    : dateFields
      ? "tsconfig.date-fields."
      : "tsconfig.";
const javaDriver = calendar
  ? "CalendarDrive"
  : duration
    ? "DurationDrive"
    : dateFields
      ? "DateFieldsDrive"
      : "Drive";
const cDriver = calendar
  ? "calendar-drive.c"
  : duration
    ? "duration-drive.c"
    : dateFields
      ? "date-fields-drive.c"
      : "drive.c";
const witnessScope = calendar
  ? "calendar"
  : duration
    ? "duration"
    : dateFields
      ? "date-fields"
      : "";
if (process.argv.includes("--pinned-native")) {
  env.PKG_CONFIG_LIBDIR = resolve(root, "target/ecmascript/icu-native-pin/install/lib/pkgconfig");
}
mkdirSync(out, { recursive: true });

function run(
  binary: string,
  args: string[],
  cwd = root,
  executionEnv: NodeJS.ProcessEnv = env,
  receipt?: string,
): string {
  const result = spawnSync(binary, args, {
    cwd,
    env: executionEnv,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const diagnostics = result.stdout + result.stderr;
  if (receipt !== undefined) writeFileSync(receipt, diagnostics);
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

run(process.execPath, [resolve(provider, "../../tools/generate-locale-preferences.ts"), "--check"]);
if (calendar)
  run(process.execPath, [resolve(provider, "../../tools/generate-lunisolar-data.ts"), "--check"]);

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

const jvm = resolve(out, witnessScope ? "jvm-" + witnessScope : "jvm");
run(nts, ["emit-jvm", resolve(fixture, configuration + "jvm.json"), "--out", jvm]);
if (calendar) {
  writeFileSync(
    resolve(jvm, "CalendarCases.java"),
    [
      "final class CalendarCases {",
      "  static final class Case { final String calendar, expected; final double day;",
      "    Case(String calendar, double day, String expected) { this.calendar = calendar; this.day = day; this.expected = expected; } }",
      "  static final Case[] CASES = {",
      ...calendarCases.map(
        (sample) =>
          `    new Case(${JSON.stringify(sample.calendar)}, ${sample.day}, ${JSON.stringify(sample.expected)}),`,
      ),
      "  };",
      "  static final Case[] TABLE_CASES = {",
      ...calendarTableCases.map(
        (sample) =>
          `    new Case(${JSON.stringify(sample.calendar)}, ${sample.day}, ${JSON.stringify(sample.expected)}),`,
      ),
      "  };",
      "  static final String[] IDS = {" +
        calendarIdentifiers.map((id) => JSON.stringify(id)).join(",") +
        "};",
      "}",
    ].join("\n"),
  );
}
const classpath = [jvm, resolve(jvm, "nts-runtime.jar"), java, jar].join(
  process.platform === "win32" ? ";" : ":",
);
run("javac", [
  "--release",
  "11",
  "-cp",
  classpath,
  "-d",
  jvm,
  resolve(fixture, javaDriver + ".java"),
  ...(calendar ? [resolve(jvm, "CalendarCases.java")] : []),
]);
const jvmResult = run(
  "java",
  ["-Xverify:all", "-cp", classpath, javaDriver],
  root,
  env,
  resolve(jvm, "result.log"),
);

const native = resolve(out, witnessScope ? "native-" + witnessScope : "native");
mkdirSync(native, { recursive: true });
if (calendar) {
  writeFileSync(
    resolve(native, "calendar-cases.h"),
    [
      "typedef struct { const char *calendar; double day; const char *expected; } CalendarCase;",
      "static const CalendarCase calendar_cases[] = {",
      ...calendarCases.map(
        (sample) =>
          `  {${JSON.stringify(sample.calendar)}, ${sample.day}, ${JSON.stringify(sample.expected)}},`,
      ),
      "};",
      "static const CalendarCase calendar_table_cases[] = {",
      ...calendarTableCases.map(
        (sample) =>
          `  {${JSON.stringify(sample.calendar)}, ${sample.day}, ${JSON.stringify(sample.expected)}},`,
      ),
      "};",
      "static const char *const calendar_ids[] = {" +
        calendarIdentifiers.map((id) => JSON.stringify(id)).join(",") +
        "};",
    ].join("\n"),
  );
}
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
  ["display", resolve(provider, "c/nts_icu_display.c")],
  ["segment", resolve(provider, "c/nts_icu_segment.c")],
] as const) {
  if (calendar && name !== "unicode" && name !== "provider") continue;
  if (dateFields && name !== "unicode" && name !== "provider") continue;
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
for (const name of ["locale", "number_range", "date_pattern", "date", "plural", "calendar"]) {
  if (calendar && name !== "calendar") continue;
  if (dateFields && name !== "date" && name !== "date_pattern") continue;
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
  const directory =
    backend === "c" && rc
      ? native
      : resolve(out, "native-" + (witnessScope ? witnessScope + "-" : "") + name);
  mkdirSync(directory, { recursive: true });
  const program = resolve(directory, backend === "c" ? "program.c" : "program.ll");
  if (backend === "c")
    run(nts, [
      "emit-c",
      resolve(fixture, configuration + "c.json"),
      ...(rc ? ["--rc"] : []),
      "--out",
      directory,
    ]);
  else
    writeFileSync(
      program,
      run(nts, ["emit-llvm", resolve(fixture, configuration + "c.json"), ...(rc ? ["--rc"] : [])]),
    );
  const objects = [...providerObjects];
  for (const [file, input] of [
    ["program", program],
    ["runtime", resolve(root, "runtime/c/nts_runtime.c")],
    ["drive", resolve(fixture, cDriver)],
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
      ...(calendar ? ["-I" + native] : []),
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
  // NoGC deliberately retains its bump-allocated heap until process exit.
  // Check leaks in RC, where destruction is part of the contract. ASan/UBSan
  // still check memory access and arithmetic in every native configuration.
  const executionEnv =
    sanitize.length > 0
      ? { ...env, ASAN_OPTIONS: (env.ASAN_OPTIONS ?? "") + ":detect_leaks=" + (rc ? "1" : "0") }
      : env;
  return {
    executable,
    result: run(executable, [], root, executionEnv, resolve(directory, "result.log")),
    backend: name,
  };
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
  "America/New_York:-18000000:1710055800000:1730611800000:1710054000000\n900,719,925,474,099,312,345.00;minusSign=-;integer=12;group=,;integer=345;decimal=.;fraction=678\n𝟗𝟎𝟎,𝟕𝟏𝟗,𝟗𝟐𝟓,𝟒𝟕𝟒,𝟎𝟗𝟗,𝟑𝟏𝟐,𝟑𝟒𝟓.𝟎𝟎;minusSign=-;integer=𝟏𝟐;group=,;integer=𝟑𝟒𝟓;decimal=.;fraction=𝟔𝟕𝟖\n+1.3%\n($1.05)\n¥1,235\nKWD 1.235\n1.2K\n12.4 meters per second\n001\n13\n0.10\nZZZ 1.23\n~$1;currency=$=startRange;integer=3=startRange;literal= – =shared;currency=$=endRange;integer=5=endRange\n1:2:~0\n987,654,321,987,654,321–987,654,321,987,654,322\nbuddhist,gregory;standard,phonebk,search,emoji,eor;h12,h23;h23,h12;Asia/Tokyo;521;522;1;0;-1";
expected = expected.replace(
  "\n900,",
  [
    "",
    "temporal-gap:2024-03-10T07:30:00.123456789Z:2024-03-10T06:30:00.123456789Z:2024-03-10T07:30:00.123456789Z",
    "temporal-fold:2024-11-03T05:30:00.123456789Z:2024-11-03T05:30:00.123456789Z:2024-11-03T06:30:00.123456789Z",
    "temporal-half-gap:2024-10-05T15:45:00Z:2024-10-05T15:15:00Z:2024-10-05T15:45:00Z",
    "temporal-half-fold:2024-04-06T14:45:00Z:2024-04-06T14:45:00Z:2024-04-06T15:15:00Z",
    "temporal-skipped-date:2011-12-30T22:00:00Z:2011-12-29T22:00:00Z:2011-12-30T22:00:00Z",
    "temporal-start:2024-03-10T05:00:00Z:23:2024-11-03T04:00:00Z:25:1972-01-07T00:44:30Z:2011-12-30T10:00:00Z",
    "temporal-transition:1710054000000:1710054000000:1699164000000:1730613600000:null",
    "temporal-negative-transition:-2717650800000:-2717650800000",
    "temporal-endpoints:+275760-09-13T23:59:00+23:59:-271821-04-19T00:01:00-23:59",
    "temporal-offset:1972-01-06T22:15:30-00:45:-00:44:30:-00:00:00.000000001:+00:00:1970-01-01T05:29:59.999999999+05:30",
    "temporal-offset-selection:2024-11-03T06:30:00Z:2024-11-03T06:30:00Z:2024-11-03T04:30:00Z",
    "temporal-rounded-match:1880-01-01T04:56:02Z",
    "temporal-zone-like:-07:00:UTC:UTC:UTC:+05:30",
    "temporal-calendar-add:2024-03-10T16:00:00Z:2024-03-10T17:00:00Z:2024-11-03T17:00:00Z:2024-11-03T16:00:00Z",
    "temporal-calendar-special:2024-02-29T17:00:00Z:2011-12-30T22:00:00Z:2024-11-03T06:30:00Z",
    "temporal-round-day:2024-03-10T05:00:00Z:2024-03-11T04:00:00Z:2024-11-04T05:00:00Z:2024-11-03T04:00:00Z",
    "temporal-round-fold:2024-11-03T05:00:00Z:2024-11-03T06:00:00Z:2024-03-10T07:00:00Z:2024-10-05T15:30:00Z",
    "temporal-zone-cache:446:1165128",
    "900,",
  ].join("\n"),
);
expected += [
  "",
  "locale:fa-JP-u-rg-thzzzz-sd-inka:buddhist,gregory;h23,h12;521",
  "locale:fa-JP-u-sd-inka:gregory,japanese;h23,h11,h12;521",
  "locale:fa-u-sd-inka:gregory,indian;h12,h23;9",
  "locale:fa:persian,gregory,islamic-civil,islamic-tbla;h12,h23;263",
  "locale:eo:gregory;h23,h12;522",
  "locale:fa-IN-u-rg-zzzzzz:gregory,indian;h12,h23;9",
  "locale:en-US-u-rg-grzzzz:gregory;h12,h23;522",
  "locale:en-JP:gregory,japanese;h23,h11,h12;521",
  "locale:en-001:gregory;h12,h23;522",
  "locale:und-001:gregory;h23,h12;522",
  "locale:fr-CA:gregory;h23,h12;521",
  "locale:en-CA:gregory;h12,h23;521",
  "locale:en-SA:gregory,islamic-umalqura;h12,h23;769",
  "locale:en-US-u-ca-foobar-hc-foobar:foobar;foobar;521",
  "locale-zones:UA:Europe/Kyiv,Europe/Simferopol",
  "locale-zones:IN:Asia/Kolkata",
  "locale-zones:SK:Europe/Bratislava",
  "locale-zones:CZ:Europe/Prague",
  "locale-zones:NO:Europe/Oslo",
  "locale-zones:AX:Europe/Mariehamn",
  "locale-zones:ZZ:",
  "locale-zones:001:",
].join("\n");
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
expected +=
  "\ncalendar:16:3877277735:true:true\ncollation:12:899042060:true:true\ncurrency:307:1334098130:true:true\nnumberingSystem:78:28763515:true:true\ntimeZone:446:1759273099:true:true\nunit:45:2973811530:true:true";
expected +=
  "\nEurope/Kyiv:Asia/Kolkata:Europe/Bratislava:Europe/Prague:Arctic/Longyearbyen:UTC:Etc/GMT+1:Europe/Kiev";
expected +=
  "\nsegments:0:5:4210:0:2:false,2:4:false,4:15:false,15:19:false,19:20:false\nsegments:1:10:8776:0:5:true,5:6:false,6:7:false,7:9:true,9:10:false,10:11:false,11:14:true,14:18:true,18:21:true,21:25:true\nsegments:2:4:4692:0:5:false,5:11:false,11:18:false,18:20:true\nsegments:3:6:486:0:1:false,1:2:false,2:3:false,3:4:false,4:5:false,5:6:false\nsegments:4:3:296549:0:513:true,513:514:false,514:515:true";
expected +=
  "\nAmerican English:English (United States):Hebrew:undefined\nUnited States:undefined\nSimplified Han:Traditional Han:undefined\nUS Dollar:Unknown Currency:undefined:XZZ";
expected +=
  "\nGregorian Calendar:Hijri Calendar (tabular, civil epoch):Ethiopic Amete Alem Calendar:foobar";
expected +=
  "\nera,year,quarter,month,week,day of the week,day,AM/PM,hour,minute,second,time zone:month\nera,yr.,qtr.,mo.,wk.,day of wk.,day,AM/PM,hr.,min.,sec.,zone:mo.\nera,yr,qtr,mo,wk,day of wk.,day,AM/PM,hr,min,sec,zone:mo";
expected += "\nA, , and B;element=2;literal=2;element=0;literal=6;element=1";
expected += "\nA e iglesia:A y hielo:A u 11:A o 110\nA וב:A ו-😀\nA, B, C, D rānei";
expected += "\n0 days ago:in 0 days:today:in 0.001 days:in 0.999 days";
expected +=
  "\nin 1,234.5 days;literal=in ;integer=1=day;group=,=day;integer=234=day;decimal=.=day;fraction=5=day;literal= days";
expected += "\nza 1000 dni\nin 𝟏𝟐.𝟓 days;0=3:7;2=7:8;1=8:10";
expected += "\none,other:one:one:other:one:other";
expected += "\none,two,few,other:other:one:two:few:other:other:one:one:other";
expected += "\nother:one\none:few\nmany:many:one\none:other:one\nother:other";
if (dateFields)
  expected = [
    "0:2030|2|29|Sunday|00:00:00.000:8:2556",
    "same-instant:2000",
    "utf16:𝟐𝟎𝟑𝟎|𝟏|𝟐𝟗:16;11=0:8;2=9:11;3=12:16",
    "mixed:U'r 1 29 2030 年 geng-xu 00:00 0047;2=4:5;3=6:8;11=9:13;12=16:23;4=24:26;5=27:29;1=30:34",
    "offset:-14400000",
    "interval-data:order:fields:fallback:connector",
  ].join("\n");
if (duration)
  expected = [
    "1 yr, 2 mths, 3 wks, 4 days, 5 hr, 6 min, 7 sec, 8 ms, 9 μs, 10 ns",
    "-1 yr, 2 mths, 3 wks, 4 days, 5 hr, 6 min, 7 sec, 8 ms, 9 μs, 10 ns",
    "5 days, 1 hr, 2:03",
    "0:00:10000000.000000001",
    "0:00:9007199254740991.975424",
    "-0:00:01.000000001",
    "7.08.09",
    "𝟕:𝟎𝟖:𝟎𝟗",
  ].join("\n");
const extendedFailures: { calendar: string; firstMismatchDay: number }[] = [];
if (calendar) {
  const rows = jvmResult.split("\n");
  const tableOffset = calendarCases.length + calendarIdentifiers.length;
  if (rows.length !== tableOffset + calendarTableCases.length + 2)
    throw new Error("Calendar witness omitted a result");
  for (let index = 0; index < calendarCases.length; index++)
    if (rows[index] !== calendarCases[index]!.expected)
      throw new Error("Calendar golden mismatch at " + index);
  for (let index = 0; index < calendarIdentifiers.length; index++) {
    const id = calendarIdentifiers[index]!;
    const prefix = id + ":roundtrips:55000:invalid:true:extended:";
    const row = rows[calendarCases.length + index]!;
    if (!row.startsWith(prefix)) throw new Error("Calendar witness omitted " + id);
    const failure = Number(row.slice(prefix.length));
    if (!Number.isInteger(failure) || failure > 0 || failure < -1001)
      throw new Error("Invalid calendar range result: " + row);
    if (failure < 0)
      extendedFailures.push({
        calendar: id,
        firstMismatchDay: -100000000 + (-failure - 1) * 200000,
      });
  }
  for (let index = 0; index < calendarTableCases.length; index++)
    if (rows[tableOffset + index] !== calendarTableCases[index]!.expected)
      throw new Error("Lunisolar table golden mismatch at " + index);
  if (
    rows[tableOffset + calendarTableCases.length] !== "chinese:table-roundtrips:73442" ||
    rows[tableOffset + calendarTableCases.length + 1] !== "dangi:table-roundtrips:55193"
  )
    throw new Error("Lunisolar table coverage mismatch");
  // Fixed goldens and modern-day round trips are checked above and in the
  // drivers. Keep the wider failures in the C/JVM parity result, then fail the
  // full-range gate below; agreement on a failure is not acceptance.
  expected = jvmResult;
}
if (jvmResult !== expected) throw new Error("ICU compiled ABI mismatch on JVM:\n" + jvmResult);
// ICU4C supplies contextual script names; ICU4J supplies standalone names.
// ICU4J also drops a short region name equal to the code (US) and uses the
// long form. These pinned public APIs differ in data selection, which ECMA-402
// permits. Preserve exact expected text for both providers.
const nativeExpected = duration
  ? expected
  : expected
      .replace("\nUnited States:undefined\n", "\nUS:undefined\n")
      .replace(
        "\nSimplified Han:Traditional Han:undefined\n",
        "\nSimplified:Traditional:undefined\n",
      );
for (const result of nativeResults)
  if (result.result !== nativeExpected)
    throw new Error("ICU compiled ABI mismatch on " + result.backend + ":\n" + result.result);
console.log(
  JSON.stringify({
    mode: calendar
      ? "compiled-ICU-calendar-data"
      : duration
        ? "compiled-ICU-duration-text"
        : dateFields
          ? "compiled-ICU-date-fields"
          : "compiled-ICU-ABI",
    icu: version,
    backends: [...nativeResults.map((result) => result.backend), "jvm"],
    ...(calendar
      ? {
          calendarData: true,
          goldenCases: calendarCases.length,
          lunisolarTableGoldenCases: calendarTableCases.length,
          lunisolarTableRoundTripsPerBackend: 73442 + 55193,
          modernRoundTripsPerBackend: calendarIdentifiers.length * 55000,
          hebrewSharedAgreementDaysPerBackend: 55000,
          arithmeticSharedAgreementDaysPerBackend: 550000,
          extendedHebrewProvider: "shared-arithmetic",
          extendedArithmeticProvider: "shared-arithmetic",
          extendedSamplesRequestedPerBackend: calendarIdentifiers.length * 1001,
          extendedRange: extendedFailures.length === 0,
          extendedFailures,
          compiledPublicApi: false,
        }
      : duration
        ? { durationText: true, durationParts: false, compiledPublicApi: false }
        : dateFields
          ? {
              preparedDateFields: true,
              utf16Spans: true,
              publicDateFieldMapping: true,
              dateTimeTemplateGrammars: true,
              intervalPatternData: true,
              compiledPublicApi: false,
            }
          : {
              exactDecimal: true,
              utf16Parts: true,
              dst: true,
              temporalTimeZones: true,
              temporalTimeZoneCache: true,
              temporalZonedISOArithmetic: true,
              temporalTimeZoneErrors: false,
              numberOptions: true,
              numberRanges: true,
              localeData: true,
              localePreferences: true,
              collation: true,
              datePatterns: true,
              dateText: true,
              dateRanges: true,
              timeZoneIdentifiers: true,
              supportedValues: true,
              primaryTimeZoneIdentifiers: true,
              displayNames: true,
              segmenter: true,
              listPatterns: true,
              relativeTime: true,
              pluralRules: true,
            }),
    sanitize: sanitize.length > 0,
    ...(sanitize.length > 0 ? { leakDetection: "RC; NoGC intentionally retains its heap" } : {}),
  }),
);
if (calendar && extendedFailures.length > 0)
  throw new Error(
    "Calendar conversion estimates require shared full-range boundary resolution; retained failures: " +
      JSON.stringify(extendedFailures),
  );
if (process.argv.includes("--bench")) {
  for (const kind of ["fields", "currency"]) {
    console.log("C", run(executable, ["250000", "display", kind]));
    console.log(
      "JVM",
      run("java", ["-Xverify:all", "-cp", classpath, javaDriver, "250000", "display", kind]),
    );
  }
  for (const key of ["numberingSystem", "timeZone"]) {
    const arguments_ = ["100000", "supported", key];
    console.log(run(executable, arguments_));
    console.log(run("java", ["-Xverify:all", "-cp", classpath, "Drive", ...arguments_]));
  }
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
