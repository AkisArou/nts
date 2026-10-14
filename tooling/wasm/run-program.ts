// Run a whole program emitted for node and end it as the C runtime ends a
// native one, so one classifier reads every backend's runs.
//
//   nts emit-wasm <project> --out <dir> --host node
//   node tooling/wasm/run-program.ts <dir>
//
// The program is the module's initializer: importing `program.mjs` runs it,
// and its console lines reach stdout and stderr as it writes them. A program
// that completes, with every job and timer it queued, exits 0. Otherwise this
// says what stopped it on stderr, in the C runtime's words, and exits 1:
// - `nts: uncaught <Class>: <message>` for a thrown object, by its class's
//   name and the message the core read for it (`nts_uncaught`), `[object]`
//   where no one class names it;
// - `nts: uncaught <value>` for a thrown primitive, a number as C's `%g`
//   prints it;
// - `nts: refused at run time: <reason>` for a refusal (NTS5001);
// - `nts: wasm trap: <message>` for a trap, which is a compiler or runtime
//   defect and never the program's own doing.
// A module that does not load is not a run at all: `nts: wasm did not load`,
// status 2. That includes an engine without a capability the module needs
// (the glue's `WasmEngineMissing`: JSTag, the JS string builtins, imported
// string constants).
//
// The module cannot end the process itself. Checkers and any JS host import
// it too, and a library that exited on a throw would end its importer; ending
// the process is the host's, as it is C's runtime's.
import path from "node:path";
import { pathToFileURL } from "node:url";

/** What the generated glue's refusal carries (`WasmInputDecline`). */
type Decline = TypeError & {
  code: "NTS5001";
  reason: string;
  uncaught?: { name: string | null; message: string | null };
};

function isDecline(value: unknown): value is Decline {
  return value instanceof TypeError && (value as { code?: unknown }).code === "NTS5001";
}

/** C's `%g`: six significant digits, the exponent form outside [1e-4, 1e6),
 *  trailing zeros dropped, and an exponent of at least two digits. */
export function formatG(value: number): string {
  if (Number.isNaN(value)) return "nan";
  if (!Number.isFinite(value)) return value < 0 ? "-inf" : "inf";
  if (value === 0) return Object.is(value, -0) ? "-0" : "0";
  const [mantissa, exponentText] = value.toExponential(5).split("e");
  const exponent = Number(exponentText);
  const trim = (digits: string) => (digits.includes(".") ? digits.replace(/\.?0+$/, "") : digits);
  if (exponent < -4 || exponent >= 6) {
    const sign = exponent < 0 ? "-" : "+";
    return `${trim(mantissa)}e${sign}${String(Math.abs(exponent)).padStart(2, "0")}`;
  }
  return trim(value.toFixed(5 - exponent));
}

/** The line C's runtime ends a program with, for whatever stopped it. */
export function lastWords(stopped: unknown): string {
  if (isDecline(stopped)) {
    if (stopped.uncaught) {
      const { name, message } = stopped.uncaught;
      return `nts: uncaught ${name ?? "[object]"}${message === null ? "" : `: ${message}`}`;
    }
    return `nts: refused at run time: ${stopped.reason}`;
  }
  if (stopped instanceof WebAssembly.RuntimeError) return `nts: wasm trap: ${stopped.message}`;
  if (stopped instanceof Error) return `nts: uncaught ${stopped.name}: ${stopped.message}`;
  if (typeof stopped === "number") return `nts: uncaught ${formatG(stopped)}`;
  return `nts: uncaught ${String(stopped)}`;
}

function end(stopped: unknown): never {
  process.stderr.write(`${lastWords(stopped)}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [artifact] = process.argv.slice(2);
  if (!artifact) {
    process.stderr.write("usage: node tooling/wasm/run-program.ts <artifact directory>\n");
    process.exit(2);
  }
  // A job or a timer runs after the initializer returns, and may throw then.
  process.on("uncaughtException", end);
  process.on("unhandledRejection", end);
  try {
    await import(pathToFileURL(path.resolve(artifact, "program.mjs")).href);
  } catch (stopped) {
    const found = stopped as { code?: unknown; missing?: unknown } | null;
    const absent = found?.code === "ERR_MODULE_NOT_FOUND" || typeof found?.missing === "string";
    if (stopped instanceof WebAssembly.CompileError || stopped instanceof WebAssembly.LinkError || absent) {
      process.stderr.write(`nts: wasm did not load: ${stopped.message}\n`);
      process.exit(2);
    }
    end(stopped);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
