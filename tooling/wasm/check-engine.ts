// What a program's glue says on an engine without a capability it needs.
//
//   node tooling/wasm/check-engine.ts <artifact> <engine>
//
// `<engine>` is the node running this, made to lack one thing before the glue
// loads: `full` (nothing), `no-tag` (no `WebAssembly.JSTag`), `no-builtins`
// (a `compile` that ignores both builtin options) or `no-constants` (one that
// ignores `importedStringConstants`). Prints one JSON line: `missing`, what
// the glue named (`WasmEngineMissing`), else null; and `ran`, whether the
// program loaded and ran (completed, or stopped by its own throw).
import path from "node:path";
import { pathToFileURL } from "node:url";

type Options = { builtins?: string[]; importedStringConstants?: string };

const [artifact, engine] = process.argv.slice(2);
const compile = WebAssembly.compile.bind(WebAssembly);
switch (engine) {
  case "full":
    break;
  case "no-tag":
    Reflect.deleteProperty(WebAssembly, "JSTag");
    break;
  case "no-builtins":
    WebAssembly.compile = (bytes: BufferSource) => compile(bytes);
    break;
  case "no-constants":
    WebAssembly.compile = (bytes: BufferSource, options?: Options) =>
      (compile as (bytes: BufferSource, options?: Options) => Promise<WebAssembly.Module>)(bytes, {
        builtins: options?.builtins,
      });
    break;
  default:
    throw new Error(`unknown engine \`${engine}\``);
}
let missing: string | null = null;
let ran = true;
try {
  await import(pathToFileURL(path.resolve(artifact, "program.mjs")).href);
} catch (stopped) {
  const found = stopped as { code?: unknown; missing?: unknown };
  if (typeof found.missing === "string") {
    missing = found.missing;
    ran = false;
  } else if (found.code !== "NTS5001") {
    ran = false;
  }
}
process.stdout.write(`${JSON.stringify({ missing, ran })}\n`);
