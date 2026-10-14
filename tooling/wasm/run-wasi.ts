// Run a WASI preview-1 module on node's V8, as `wasmtime run` would.
//
//   node tooling/wasm/run-wasi.ts <module.wasm> [args...]
//
// The benchmarks' C++ references compiled to `wasm32-wasip1` run here for the
// `C++ (wasm)` column: the same engine the `nts (wasm)` column runs on, so the
// ratio between them is about the code, not the engine. The module's stdout is
// this process's, and its exit status is too.
import { readFileSync } from "node:fs";
import { WASI } from "node:wasi";

const [path, ...args] = process.argv.slice(2);
if (!path) {
  process.stderr.write("usage: node tooling/wasm/run-wasi.ts <module.wasm> [args...]\n");
  process.exit(2);
}
const wasi = new WASI({ version: "preview1", args: [path, ...args], env: {}, returnOnExit: true });
const module = await WebAssembly.compile(readFileSync(path));
const instance = await WebAssembly.instantiate(module, wasi.getImportObject() as WebAssembly.Imports);
process.exitCode = wasi.start(instance);
