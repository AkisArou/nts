// `process.emitWarning`, from node v24.20.0 `lib/internal/process/warning.js`.
//
// A warning is an `Error` that is emitted rather than thrown. That is not a
// trick: the program should carry on, but somebody needs a stack, a name and a
// code, and `Error` is the only thing that carries all three. Emitting it as
// an event rather than printing it is what lets a program install its own
// handler and, for instance, turn deprecations into failures in CI.
//
// It is delivered on the *next tick* rather than now. Two reasons, and both
// bite in practice. A warning raised while a module is being evaluated would
// otherwise fire before the program has had a chance to listen for it, which
// is unfixable from the outside. And a warning raised from inside a hot
// function would run the handler on that function's stack, so the cost of
// warning would be charged to the caller.

import { ERR_INVALID_ARG_TYPE, captureStackTrace } from "../../internal/errors.ts";
import { validateString } from "../../internal/validators.ts";

/** What `emitWarning` needs from the process it belongs to. */
export interface WarningTarget {
  nextTick<Args extends unknown[]>(callback: (...args: Args) => void, ...args: Args): void;
  emit(event: string, ...args: unknown[]): boolean;
  noDeprecation: boolean;
  throwDeprecation: boolean;
  traceDeprecation: boolean;
  traceProcessWarnings: boolean;
  argv0: string;
  pid: number;
  release: { name: string };
  stderr: { write(text: string): unknown };
}

/** The extra fields node hangs on a warning beyond what `Error` has. */
interface Warning extends Error {
  code?: string;
  detail?: string;
}

export interface WarningOptions {
  type?: string;
  code?: string;
  detail?: string;
  ctor?: CallableFunction;
}

/** An untyped JavaScript options object before each field is validated. */
interface WarningOptionsInput {
  type?: unknown;
  code?: unknown;
  detail?: unknown;
  ctor?: unknown;
}

function isWarningOptionsInput(value: unknown): value is WarningOptionsInput {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function createWarning(
  message: string,
  type: string | undefined,
  code: string | undefined,
  ctor: CallableFunction | undefined,
  detail: string | undefined,
): Warning {
  const warning: Warning = new Error(message);
  warning.name = String(type || "Warning");
  if (code !== undefined) warning.code = code;
  if (detail !== undefined) warning.detail = detail;
  // The stack starts *above* whoever raised it. A user reading a deprecation
  // wants the line that called the deprecated thing, not the four frames of
  // machinery that produced the message.
  captureStackTrace(warning, ctor ?? emitWarningFor);
  return warning;
}

/**
 * `emitWarning`, bound to one process object.
 *
 * A factory rather than a free function because every branch here reads
 * something off the process -- the deprecation flags, the tick queue, the
 * emitter -- and passing four of them to each call would be the same coupling
 * spelled less clearly.
 */
export function emitWarningFor(target: WarningTarget) {
  // A `const` arrow rather than a named function expression: the name is
  // inferred from the binding, so `process.emitWarning.name` is still
  // `emitWarning`, and an arrow needs no `this` of its own -- which this body
  // never uses.
  const emitWarning = (
    warning: string | Error,
    type?: string | WarningOptions | CallableFunction,
    code?: string | CallableFunction,
    ctor?: CallableFunction,
  ): void => {
    // Before any allocation: a suppressed deprecation in a hot path should
    // cost a comparison, not an `Error`.
    if (target.noDeprecation && type === "DeprecationWarning") return;

    let detail: string | undefined;
    let requestedType: unknown = type;
    let requestedCode: unknown = code;
    let selectedCtor = ctor;

    if (isWarningOptionsInput(type)) {
      const optionCtor = type.ctor;
      selectedCtor = typeof optionCtor === "function" ? optionCtor : undefined;
      requestedCode = type.code;
      if (typeof type.detail === "string") detail = type.detail;
      requestedType = type.type ? type.type : "Warning";
    } else if (typeof type === "function") {
      selectedCtor = type;
      requestedCode = undefined;
      requestedType = "Warning";
    }

    let typeName: string | undefined;
    if (requestedType !== undefined) {
      validateString(requestedType, "type");
      typeName = requestedType;
    }

    let codeName: string | undefined;
    if (typeof requestedCode === "function") {
      selectedCtor = requestedCode;
    } else if (requestedCode !== undefined) {
      validateString(requestedCode, "code");
      codeName = requestedCode;
    }

    let built: Warning;
    if (typeof warning === "string") {
      built = createWarning(warning, typeName, codeName, selectedCtor, detail);
    } else if (warning instanceof Error) {
      built = warning;
    } else {
      throw new ERR_INVALID_ARG_TYPE("warning", ["Error", "string"], warning);
    }

    if (built.name === "DeprecationWarning") {
      if (target.noDeprecation) return;
      if (target.throwDeprecation) {
        // Thrown on a later tick, not here, so that warnings raised before it
        // are still delivered. Throwing synchronously would make the failure
        // depend on which warning happened to come first.
        target.nextTick(() => {
          throw built;
        });
        return;
      }
    }

    target.nextTick((w: Warning) => {
      target.emit("warning", w);
    }, built);
  };
  return emitWarning;
}

/**
 * The default `warning` listener: print it to stderr.
 *
 * Installed by the process itself, and removable -- a program that adds its
 * own handler and calls `process.removeAllListeners('warning')` gets silence,
 * which is the documented way to turn warnings off from inside.
 */
/**
 * A warning's text, however badly the warning behaves.
 *
 * The object came from the program, and a program is allowed to hand over an
 * `Error` subclass whose `toString` is null or throws. Node checks the type
 * and gets the first case; the second takes the printer down with it, which
 * node's own test only avoids by running with `--no-warnings` so the printer
 * is not installed. A handler whose job is to report a problem must not become
 * a second one, so both are handled here.
 */
function describe(warning: Warning): string {
  if (typeof warning.toString === "function") {
    try {
      return `${warning.toString()}`;
    } catch {
      // Fall through to the inherited one, which cannot be broken from
      // outside.
    }
  }
  const name = warning.name === undefined ? "Error" : String(warning.name);
  const message = warning.message === undefined ? "" : String(warning.message);
  if (name === "") return message;
  if (message === "") return name;
  return `${name}: ${message}`;
}

export function onWarningFor(target: WarningTarget) {
  let helperShown = false;

  const onWarning = (warning: unknown): void => {
    if (!(warning instanceof Error)) return;
    const w: Warning = warning;

    const isDeprecation = w.name === "DeprecationWarning";
    if (isDeprecation && target.noDeprecation) return;

    const trace = target.traceProcessWarnings || (isDeprecation && target.traceDeprecation);

    let message = `(${target.release.name}:${target.pid}) `;
    if (w.code) message += `[${w.code}] `;
    message += trace && w.stack ? `${w.stack}` : describe(w);
    if (typeof w.detail === "string") message += `\n${w.detail}`;

    // Once per process. The hint is useful the first time and noise every time
    // after, and a program that warns in a loop would otherwise print two
    // lines of advice per iteration.
    if (!trace && !helperShown) {
      helperShown = true;
      const flag = isDeprecation ? "--trace-deprecation" : "--trace-warnings";
      message += `\n(Use \`${target.argv0 || "node"} ${flag} ...\` to show where the warning was created)`;
    }

    // Through the process object rather than a captured stream: node's own
    // tests replace `process.stderr.write` to capture what a warning printed,
    // and a captured reference would write past them.
    target.stderr.write(`${message}\n`);
  };
  return onWarning;
}
