import {dataDirectory} from "../../../tooling/gate/reader-inputs/main.ts";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const out = resolve(process.argv[2] ?? `${root}/target/interop-native-compression`);
const compiler = process.env.NTS_BIN ?? `${root}/target/release/nts`;
const provider = fileURLToPath(dataDirectory(new URL("../../../runtime/web-platform/providers/native/compression/",import.meta.url)));
mkdirSync(out, { recursive: true });
function run(name: string, command: string, args: string[], env = process.env): Buffer {
  const r = spawnSync(command, args, { cwd: root, env, maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(`${out}/${name}.stdout`, r.stdout ?? "");
  writeFileSync(`${out}/${name}.stderr`, r.stderr ?? "");
  if (r.status !== 0) throw new Error(`${name}: ${r.error ?? r.signal ?? r.status}\n${r.stderr}`);
  return r.stdout;
}
run("build", compiler, ["build", "tests/interop/native-compression", "--out", `${out}/products`, "--rc"]);
const expected = readFileSync(new URL("./expected.txt",import.meta.url));
for (const backend of ["c", "llvm"]) {
  const actual = run(backend, `${out}/products/${backend}/linux-gnu-x86_64/${backend}`, []);
  if (!actual.equals(expected)) throw new Error(`${backend}: output differs`);
}
const cc = process.env.CC ?? "clang";
const request = `${out}/dependencies.json`;
writeFileSync(request, JSON.stringify({ target: "x86_64-unknown-linux-gnu", compiler: [cc],
  archiver: ["llvm-ar"], flags: ["-O3"], libraries: ["brotli", "zlib"],
  cache: `${process.env.XDG_CACHE_HOME ?? `${process.env.HOME}/.cache`}/nts/node-deps`, jobs: 1 }));
const deps = JSON.parse(run("dependencies", compiler, ["node-deps", request]).toString()) as {
  include_flags: string[]; link_flags: string[];
};
const binary = `${out}/probe`;
run("compile-probe", cc, ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror",
  "-DNTS_PROVIDER_RC", "-ffunction-sections", "-fdata-sections", `-I${root}/runtime/c`, `-I${provider}`,
  ...deps.include_flags, `${provider}/nts_web_compression.c`, fileURLToPath(new URL("../../../runtime/c/nts_runtime.c",import.meta.url)),
  fileURLToPath(new URL("./native-probe.c",import.meta.url)), "-Wl,--gc-sections", "-o", binary,
  ...deps.link_flags, "-lm", "-pthread"]);
process.stdout.write(run("probe", binary, []));

// Run the same source APIs and WPT case names against the shipping C codec.
// This is host Node plus a compiled native transport, not compiled TS evidence.
const addon = `${out}/provider.node`;
const include = resolve(dirname(process.execPath), "../include/node");
run("compile-transport", cc, ["-std=c11", "-O2", "-fPIC", "-shared", "-fvisibility=hidden",
  "-DNTS_PROVIDER_RC", "-ffunction-sections", "-fdata-sections", `-I${include}`,
  `-I${root}/runtime/c`, `-I${provider}`, ...deps.include_flags,
  `${provider}/nts_web_compression.c`, fileURLToPath(new URL("../../../runtime/c/nts_runtime.c",import.meta.url)),
  fileURLToPath(new URL("./provider-addon.c",import.meta.url)), "-Wl,--gc-sections", "-o", addon,
  ...deps.link_flags, "-lm", "-pthread"]);
const host = run("package-native-transport", process.execPath, ["--expose-gc", "--import",
  fileURLToPath(new URL("./provider-loader.mjs",import.meta.url)), "--test",
  fileURLToPath(new URL("../../../runtime/web-platform/test/compression-provider.test.ts",import.meta.url)),
  fileURLToPath(new URL("../../../runtime/web-platform/test/compression-runtime.test.ts",import.meta.url)),
  fileURLToPath(new URL("../../../runtime/web-platform/test/compression.test.ts",import.meta.url)),
  fileURLToPath(new URL("../../../runtime/web-platform/test/wpt-compression.test.ts",import.meta.url))],
{ ...process.env, NTS_COMPRESSION_TEST_ADDON: addon });
process.stdout.write(host);
