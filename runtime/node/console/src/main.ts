// `node:console`, from node v24.20.0 `lib/internal/console/constructor.js` and
// `lib/internal/console/global.js`.
//
// Most of the module is `util.format` and a stream write. What remains is the
// state the API implies -- a timer table for `time`, a counter table for
// `count`, an indentation level for `group` -- and the care taken not to let a
// failed write take the program down, since a debugging aid that crashes the
// thing being debugged is worse than useless.
//
// Two objects come out of here. `Console` is the class, which takes streams.
// The global `console` is *not* an instance of it: node builds it as a plain
// namespace object with the methods bound to it, so that `const { log } =
// console` works and so that `Console.prototype` is not in the global's
// prototype chain. That distinction is observable and the tests check it.

import { channel } from "../../diagnostics_channel/src/main.ts";
import { formatWithOptions } from "../../util/src/format.ts";
import { inspect, type InspectOptions } from "../../util/src/inspect.ts";
import { isMap, isMapIterator, isSet, isSetIterator, isTypedArray } from "../../util/src/types.ts";
import { cliTable } from "../../internal/cli-table.ts";
import { shouldColorize } from "../../internal/colors.ts";
import { clearScreenDown, cursorTo } from "../../internal/readline-callbacks.ts";
import * as stdio from "../../internal/stdio.ts";
import type { WritableLike } from "../../internal/stdio.ts";
import { formatTime, time, timeEnd, timeLog, type Timestamp } from "../../internal/time.ts";
import {
  ERR_CONSOLE_WRITABLE_STREAM,
  ERR_INCOMPATIBLE_OPTION_PAIR,
} from "../../internal/errors.ts";
import { validateArray, validateInteger, validateObject, validateOneOf } from "../../internal/validators.ts";

declare function nts_process_env(name: string): string;

export type { WritableLike };

/** Options accepted by `new Console({ ... })`. */
export interface ConsoleOptions {
  stdout: WritableLike;
  stderr?: WritableLike;
  /** Swallow write errors rather than letting them reach the caller. */
  ignoreErrors?: boolean;
  /** `true`, `false`, or `"auto"`, which asks the stream. */
  colorMode?: boolean | "auto";
  /** Passed to `util.inspect`; a `Map` keyed by stream to differ per stream. */
  inspectOptions?: InspectOptions | Map<WritableLike, InspectOptions>;
  /** Spaces added per `group()` level. Default 2. */
  groupIndentation?: number;
}

/** A `group` deeper than this is a runaway loop, not a formatting choice. */
const kMaxGroupIndentation = 1000;

/**
 * One channel per level, published to *before* formatting.
 *
 * A subscriber sees the arguments as they were passed -- objects, not their
 * printed form -- which is what makes a log-forwarding subscriber able to
 * serialise them its own way. It also means a subscriber that mutates an
 * argument changes what gets printed, and node's tests check exactly that.
 */
const onLog = channel("console.log");
const onWarn = channel("console.warn");
const onError = channel("console.error");
const onInfo = channel("console.info");
const onDebug = channel("console.debug");

const kColorInspectOptions: InspectOptions = { colors: true };
const kNoColorInspectOptions: InspectOptions = {};

function noop(): void {}

/**
 * V8's `Error.captureStackTrace` fills in `stack` on any object and hides the
 * frames at or above `below`. It is not in TypeScript's library, so the cast
 * is here rather than as a global declaration that would claim every engine
 * has it.
 */
const { captureStackTrace } = Error as unknown as {
  captureStackTrace(target: object, below?: unknown): void;
};

/**
 * Which of the two streams a method writes to.
 *
 * The stream is looked up at write time rather than captured, because the
 * global console resolves its streams lazily and a test may replace one.
 */
/**
 * What answers `instanceof Console`. A marker rather than the prototype chain,
 * because node's global console is not an instance and still has to say yes.
 */
const kIsConsole: unique symbol = Symbol("kIsConsole") as never;

type Target = "stdout" | "stderr";

/**
 * The `console.log` family over a pair of streams.
 *
 * Every method is rebound to the instance in the constructor, so that
 * `const { log } = console` and `[1, 2].forEach(console.log)` both work --
 * which is why node does it, and why the bound copies get their `name`
 * restored afterwards.
 */
export class Console {
  declare _stdout: WritableLike;
  declare _stderr: WritableLike;
  declare _ignoreErrors: boolean;
  declare _stdoutErrorHandler: (err?: Error | null) => void;
  declare _stderrErrorHandler: (err?: Error | null) => void;
  /** Node exposes the timer table; its own tests read it. */
  declare _times: Map<string, Timestamp>;

  #counts = new Map<string, number>();
  #colorMode: boolean | "auto" = "auto";
  #inspectOptions: Map<WritableLike, InspectOptions> | undefined;
  #groupIndentWidth = 2;
  #groupIndent = "";

  constructor(options: ConsoleOptions);
  constructor(stdout: WritableLike, stderr?: WritableLike, ignoreErrors?: boolean);
  constructor(
    options: ConsoleOptions | WritableLike,
    maybeStderr?: WritableLike,
    maybeIgnoreErrors?: boolean,
  ) {
    // `new Console(out, err)` predates the options object and is still the
    // spelling most code uses. A stream is told apart from an options bag by
    // having a `write` method, which is node's own test.
    const opts: ConsoleOptions = (!options || typeof (options as WritableLike).write === "function")
      ? {
          stdout: options as WritableLike,
          stderr: maybeStderr,
          ignoreErrors: maybeIgnoreErrors,
        }
      : (options as ConsoleOptions);

    const {
      stdout: out,
      stderr: err = out,
      ignoreErrors = true,
      colorMode = "auto",
      inspectOptions,
      groupIndentation,
    } = opts;

    if (!out || typeof out.write !== "function") {
      throw new ERR_CONSOLE_WRITABLE_STREAM("stdout");
    }
    if (!err || typeof err.write !== "function") {
      throw new ERR_CONSOLE_WRITABLE_STREAM("stderr");
    }

    validateOneOf(colorMode, "colorMode", ["auto", true, false]);

    if (groupIndentation !== undefined) {
      validateInteger(groupIndentation, "groupIndentation", 0, kMaxGroupIndentation);
    }

    if (inspectOptions !== undefined) {
      validateObject(inspectOptions, "options.inspectOptions");

      const perStream = isMap(inspectOptions)
        ? inspectOptions as Map<WritableLike, InspectOptions>
        : new Map<WritableLike, InspectOptions>([
            [out, inspectOptions as InspectOptions],
            [err, inspectOptions as InspectOptions],
          ]);

      for (const streamOptions of perStream.values()) {
        // Both say what colour to use, and there is no sensible tie-break.
        if (streamOptions.colors !== undefined && (opts as ConsoleOptions).colorMode !== undefined) {
          throw new ERR_INCOMPATIBLE_OPTION_PAIR("options.inspectOptions.color", "colorMode");
        }
      }
      this.#inspectOptions = perStream;
    }

    bindMethodsTo(this);
    definePrivate(this, "_stdout", out);
    definePrivate(this, "_stderr", err);
    this.#bindProperties(ignoreErrors, colorMode, groupIndentation);
  }

  /**
   * The non-stream state, split out because the global console needs it
   * without going through the constructor.
   */
  #bindProperties(
    ignoreErrors: boolean,
    colorMode: boolean | "auto",
    groupIndentation = 2,
  ): void {
    definePrivate(this, "_stdoutErrorHandler", createWriteErrorHandler(this, "stdout"));
    definePrivate(this, "_stderrErrorHandler", createWriteErrorHandler(this, "stderr"));
    definePrivate(this, "_ignoreErrors", Boolean(ignoreErrors));
    definePrivate(this, "_times", new Map<string, Timestamp>());
    this.#colorMode = colorMode;
    this.#groupIndentWidth = groupIndentation;
    // `instanceof Console` is answered by this marker, not by the prototype
    // chain: node's global console is not an instance and still has to say yes.
    definePrivate(this, kIsConsole, true);
    definePrivate(this, Symbol.toStringTag, "console", false);
  }

  /**
   * Indent, terminate, and write -- with a write failure swallowed unless the
   * caller asked otherwise.
   *
   * A stream can fail synchronously (a file, a TTY) or asynchronously (a
   * pipe), so both are covered: the callback catches the second and the
   * `try` catches the first. A stack overflow is rethrown, because swallowing
   * that hides the actual bug.
   */
  #writeToConsole(target: Target, text: string): void {
    const ignoreErrors = this._ignoreErrors;
    const groupIndent = this.#groupIndent;

    const useStdout = target === "stdout";
    const stream = useStdout ? this._stdout : this._stderr;
    const errorHandler = useStdout ? this._stdoutErrorHandler : this._stderrErrorHandler;

    if (groupIndent.length !== 0) {
      if (text.includes("\n")) {
        text = text.replaceAll("\n", `\n${groupIndent}`);
      }
      text = groupIndent + text;
    }
    text += "\n";

    if (ignoreErrors === false) {
      stream.write(text);
      return;
    }

    try {
      // A noop listener keeps a synchronous `error` emit from becoming an
      // uncaught exception, and is removed again so that writes which are not
      // ours are unaffected.
      if (stream.listenerCount?.("error") === 0) {
        stream.once?.("error", noop);
      }
      stream.write(text, errorHandler);
    } catch (e) {
      if (isStackOverflowError(e)) {
        throw e;
      }
      // There is nowhere to report this. Console is a debugging utility and
      // failing to print is not worth failing the program over.
    } finally {
      stream.removeListener?.("error", noop);
    }
  }

  /** The `util.inspect` options for one stream: explicit ones, else colour. */
  #getInspectOptions(stream: WritableLike): InspectOptions {
    let color = this.#colorMode;
    if (color === "auto") {
      color = shouldColorize(stream);
    }

    const options = this.#inspectOptions?.get(stream);
    if (options) {
      if (options.colors === undefined) {
        options.colors = color;
      }
      return options;
    }

    return color ? kColorInspectOptions : kNoColorInspectOptions;
  }

  #format(target: Target, args: unknown[]): string {
    // A single string is already formatted; `console.log(s)` must not treat a
    // `%` in `s` as a specifier, and node's fast path is what guarantees it.
    if (args.length === 1 && typeof args[0] === "string") {
      return args[0];
    }
    const stream = target === "stdout" ? this._stdout : this._stderr;
    return formatWithOptions(this.#getInspectOptions(stream), ...args);
  }

  // ------------------------------------------------------------ the family

  log(...args: unknown[]): void {
    if (onLog.hasSubscribers) {
      onLog.publish(args);
    }
    this.#writeToConsole("stdout", this.#format("stdout", args));
  }

  info(...args: unknown[]): void {
    if (onInfo.hasSubscribers) {
      onInfo.publish(args);
    }
    this.#writeToConsole("stdout", this.#format("stdout", args));
  }

  debug(...args: unknown[]): void {
    if (onDebug.hasSubscribers) {
      onDebug.publish(args);
    }
    this.#writeToConsole("stdout", this.#format("stdout", args));
  }

  dirxml(...args: unknown[]): void {
    this.#writeToConsole("stdout", this.#format("stdout", args));
  }

  warn(...args: unknown[]): void {
    if (onWarn.hasSubscribers) {
      onWarn.publish(args);
    }
    this.#writeToConsole("stderr", this.#format("stderr", args));
  }

  error(...args: unknown[]): void {
    if (onError.hasSubscribers) {
      onError.publish(args);
    }
    this.#writeToConsole("stderr", this.#format("stderr", args));
  }

  /** One value inspected. Format specifiers are not interpreted. */
  dir(object: unknown, options?: InspectOptions): void {
    this.#writeToConsole("stdout", inspect(object, {
      customInspect: false,
      ...this.#getInspectOptions(this._stdout),
      ...options,
    }));
  }

  /** The message with a stack trace under it, on stderr. */
  trace(...args: unknown[]): void {
    const err = {
      name: "Trace",
      message: this.#format("stderr", args),
      stack: "",
    };
    // The frames start below `trace` itself: the caller wants to know where it
    // called from, not that it went through `console`.
    captureStackTrace(err, this.trace);
    this.error(err.stack);
  }

  /** https://console.spec.whatwg.org/#assert -- reports, never throws. */
  assert(expression?: unknown, ...args: unknown[]): void {
    if (!expression) {
      if (args.length > 0 && typeof args[0] === "string") {
        args[0] = `Assertion failed: ${args[0]}`;
      } else {
        args.unshift("Assertion failed");
      }
      // Through `warn`, so the arguments are format-expanded there.
      this.warn(...args);
    }
  }

  /** https://console.spec.whatwg.org/#clear -- a no-op unless stdout is a TTY. */
  clear(): void {
    if (this._stdout.isTTY && nts_process_env("TERM") !== "dumb") {
      cursorTo(this._stdout, 0, 0);
      clearScreenDown(this._stdout);
    }
  }

  // ------------------------------------------------------------- counting

  /** https://console.spec.whatwg.org/#count */
  count(label: string = "default"): void {
    // Coerces anything but a symbol, which throws -- as it should, since a
    // symbol has no string form and a count table is keyed by strings.
    label = `${label}`;
    const count = (this.#counts.get(label) ?? 0) + 1;
    this.#counts.set(label, count);
    this.log(`${label}: ${count}`);
  }

  /** https://console.spec.whatwg.org/#countreset */
  countReset(label: string = "default"): void {
    if (!this.#counts.has(label)) {
      nts_process_emit_warning(`Count for '${label}' does not exist`, "Warning", "");
      return;
    }
    this.#counts.delete(`${label}`);
  }

  // --------------------------------------------------------------- timing

  time(label: string = "default"): void {
    time(this._times, "console.time()", `${label}`);
  }

  timeEnd(label: string = "default"): void {
    timeEnd(this._times, "console.timeEnd()", this.#timeLogImpl, `${label}`);
  }

  timeLog(label: string = "default", ...data: unknown[]): void {
    timeLog(this._times, "console.timeLog()", this.#timeLogImpl, `${label}`, data);
  }

  #timeLogImpl = (label: string, formatted: string, args?: unknown[]): void => {
    if (args === undefined) {
      this.log("%s: %s", label, formatted);
    } else {
      this.log("%s: %s", label, formatted, ...args);
    }
  };

  // ------------------------------------------------------------- grouping

  group(...data: unknown[]): void {
    if (data.length > 0) {
      this.log(...data);
    }
    this.#groupIndent += " ".repeat(this.#groupIndentWidth);
  }

  groupCollapsed(...data: unknown[]): void {
    this.group(...data);
  }

  groupEnd(): void {
    this.#groupIndent = this.#groupIndent.slice(
      0,
      this.#groupIndent.length - this.#groupIndentWidth,
    );
  }

  // ---------------------------------------------------------------- table

  /**
   * https://console.spec.whatwg.org/#table
   *
   * A row per entry, a column per key seen across all entries, and an
   * `(index)` column of the keys or indices. Entries that are not objects go
   * in a `Values` column instead of contributing keys. Anything that is not an
   * object at all falls through to `log`, which is node's behaviour rather
   * than an invented shape for it.
   */
  table(tabularData: unknown, properties?: readonly string[]): void {
    if (properties !== undefined) {
      validateArray(properties, "properties");
    }

    if (tabularData === null || typeof tabularData !== "object") {
      this.log(tabularData);
      return;
    }

    const final = (k: string[], v: string[][]): void => {
      this.log(cliTable(k, v));
    };

    // Nested objects with more than two keys are printed as `[Object]`: a
    // table cell has no room for them, and the point of the table is the
    // columns rather than the values.
    const _inspect = (v: unknown): string => {
      const depth = v !== null && typeof v === "object" && !isArrayLike(v) &&
        Object.keys(v as object).length > 2 ? -1 : 0;
      return inspect(v, {
        depth,
        maxArrayLength: 3,
        breakLength: Infinity,
        ...this.#getInspectOptions(this._stdout),
      });
    };
    const getIndexArray = (length: number): string[] =>
      Array.from({ length }, (_, i) => _inspect(i));

    let data: unknown = tabularData;
    const mapIter = isMapIterator(data);
    let isKeyValue = false;
    if (mapIter) {
      // A map iterator yields entries, and the pairs are what to tabulate.
      const entries = [...(data as Iterable<unknown>)];
      isKeyValue = entries.every((e) => Array.isArray(e) && e.length === 2);
      data = entries;
    }

    if (isKeyValue || isMap(data)) {
      const keys: string[] = [];
      const values: string[] = [];
      let length = 0;
      for (const entry of data as Iterable<[unknown, unknown]>) {
        keys.push(_inspect(entry[0]));
        values.push(_inspect(entry[1]));
        length++;
      }
      final([iterKey, keyKey, valuesKey], [getIndexArray(length), keys, values]);
      return;
    }

    const setIter = isSetIterator(data);
    if (setIter) {
      data = [...(data as Iterable<unknown>)];
    }

    if (setIter || mapIter || isSet(data)) {
      const values: string[] = [];
      let length = 0;
      for (const v of data as Iterable<unknown>) {
        values.push(_inspect(v));
        length++;
      }
      final([iterKey, valuesKey], [getIndexArray(length), values]);
      return;
    }

    const map: Record<string, string[]> = { __proto__: null } as never;
    let hasPrimitives = false;
    const valuesKeyArray: string[] = [];
    const indexKeyArray = Object.keys(data as object);

    for (let i = 0; i < indexKeyArray.length; i++) {
      const item = (data as Record<string, unknown>)[indexKeyArray[i]!];
      const primitive = item === null ||
        (typeof item !== "function" && typeof item !== "object");
      if (properties === undefined && primitive) {
        hasPrimitives = true;
        valuesKeyArray[i] = _inspect(item);
      } else {
        const keys = properties ?? Object.keys(item as object);
        for (const key of keys) {
          map[key] ??= [];
          if ((primitive && properties) || !Object.hasOwn(item as object, key)) {
            map[key]![i] = "";
          } else {
            map[key]![i] = _inspect((item as Record<string, unknown>)[key]);
          }
        }
      }
    }

    const keys = Object.keys(map);
    const values = Object.values(map);
    if (hasPrimitives) {
      keys.push(valuesKey);
      values.push(valuesKeyArray);
    }
    keys.unshift(indexKey);
    values.unshift(indexKeyArray);

    final(keys, values);
  }

  // Timeline markers, so that code written for a browser runs unchanged.
  // Node's are no-ops too.
  profile(): void {}
  profileEnd(): void {}
  timeStamp(): void {}
}

const keyKey = "Key";
const valuesKey = "Values";
const indexKey = "(index)";
const iterKey = "(iteration index)";

/** What `console.table` counts as a list rather than a record. */
function isArrayLike(v: unknown): boolean {
  return Array.isArray(v) || isTypedArray(v);
}

declare function nts_process_emit_warning(message: string, name: string, code: string): void;

/**
 * V8 reports a blown stack as a plain `RangeError` with this message. There is
 * no code to test, so the message is the test -- node does the same.
 */
function isStackOverflowError(err: unknown): boolean {
  return err instanceof RangeError &&
    (err as Error).message === "Maximum call stack size exceeded";
}

function createWriteErrorHandler(
  instance: Console,
  target: Target,
): (err?: Error | null) => void {
  return (err) => {
    // True only when the write failed *and* the stream has not already
    // emitted for it -- which is the asynchronous case. Attaching a `once`
    // listener keeps that emit from becoming an uncaught exception without
    // affecting writes that are not ours.
    const stream = target === "stdout" ? instance._stdout : instance._stderr;
    if (err != null && !stream._writableState?.errorEmitted) {
      if (stream.listenerCount?.("error") === 0) {
        stream.once?.("error", noop);
      }
    }
  };
}

const consolePropAttributes = {
  writable: true,
  enumerable: false,
  configurable: true,
};

function definePrivate(
  target: object,
  key: string | symbol,
  value: unknown,
  writable = true,
): void {
  Object.defineProperty(target, key, {
    __proto__: null,
    ...consolePropAttributes,
    writable,
    value,
  } as PropertyDescriptor);
}

/**
 * Copy the methods onto `target`, bound to it.
 *
 * Binding is what makes `const { log } = console` work. `bind` renames the
 * result to `bound log`, so the name is restored -- code that reports which
 * console method it was handed should see `log`.
 */
function bindMethodsTo(target: object): void {
  for (const key of Object.getOwnPropertyNames(Console.prototype)) {
    if (key === "constructor") continue;
    // Off the instance rather than off the prototype: a subclass that
    // overrides `log` must get its own, and `class MyConsole extends Console`
    // is documented to work.
    const method = (target as Record<string, unknown>)[key];
    if (typeof method !== "function") continue;
    const bound = (method as (...a: unknown[]) => unknown).bind(target);
    Object.defineProperty(bound, "name", { __proto__: null, value: key } as PropertyDescriptor);
    (target as Record<string, unknown>)[key] = bound;
  }
}

/**
 * `Console` is callable with and without `new`.
 *
 * `Console(out, err)` is documented and used; a class constructor throws when
 * called without `new`, so the exported binding is a function that constructs
 * either way. `new.target` is forwarded, so a subclass still gets its own
 * prototype.
 */
export interface ConsoleConstructor {
  new (options: ConsoleOptions): Console;
  new (stdout: WritableLike, stderr?: WritableLike, ignoreErrors?: boolean): Console;
  (options: ConsoleOptions): Console;
  (stdout: WritableLike, stderr?: WritableLike, ignoreErrors?: boolean): Console;
  readonly prototype: Console;
}

const ConsoleCtor = function (this: unknown, ...args: unknown[]): Console {
  return Reflect.construct(Console, args, new.target ?? Console) as Console;
} as unknown as ConsoleConstructor;

Object.defineProperty(ConsoleCtor, "name", { __proto__: null, value: "Console" } as PropertyDescriptor);
(ConsoleCtor as { prototype: Console }).prototype = Console.prototype;
Object.setPrototypeOf(ConsoleCtor, Console);

Object.defineProperty(ConsoleCtor, Symbol.hasInstance, {
  __proto__: null,
  value: (instance: unknown) => Boolean((instance as Record<symbol, unknown>)?.[kIsConsole]),
} as PropertyDescriptor);

/**
 * The global `console`.
 *
 * Node builds this by hand rather than with `new Console`, so that
 * `Console.prototype` is not in the global's prototype chain -- the WHATWG
 * console specification asks for a namespace object whose prototype is empty.
 * We use a real instance. The methods are own bound properties either way, so
 * `const { log } = console` and `Reflect.ownKeys(console)` agree; the only
 * difference is what `Object.getPrototypeOf(console)` returns, and nothing
 * observes that. In exchange the class keeps private fields instead of the
 * symbol-keyed properties a non-instance would force.
 */
export const globalConsole: Console = new Console({
  stdout: stdio.stdout,
  stderr: stdio.stderr,
});

// Legacy: the constructor is reachable from the instance, which is how
// `const { Console } = console` finds it.
(globalConsole as unknown as { Console: ConsoleConstructor }).Console = ConsoleCtor;

export { ConsoleCtor as Console_, formatTime };
export default globalConsole;
