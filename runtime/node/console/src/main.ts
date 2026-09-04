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
// The global `console` is one eagerly constructed instance with the same
// statically listed bound methods. Node builds its global as a prototype-less
// namespace and customises `instanceof`; both operations require the §13
// metaobject protocol. A real instance preserves the typed behavior while
// leaving prototype identity deliberately unmodelled.

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
import { emitWarning } from "../../internal/process-warning.ts";
import {
  captureStackTrace,
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

/**
 * Structural view used only to distinguish the two constructor overloads.
 * A stream supplies `write`; an options bag supplies `stdout` instead.
 */
interface ConsoleConstructorOptions extends ConsoleOptions {
  write?: WritableLike["write"];
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

class CollectedValue {
  readonly value: unknown;
  next: CollectedValue | null = null;

  constructor(value: unknown) {
    this.value = value;
  }
}

/** Materialize an iterator once without selecting growable array storage. */
function collectIterable(iterable: Iterable<unknown>): unknown[] {
  let head: CollectedValue | null = null;
  let tail: CollectedValue | null = null;
  let length = 0;

  for (const value of iterable) {
    const node = new CollectedValue(value);
    if (tail === null) head = node;
    else tail.next = node;
    tail = node;
    length++;
  }

  const values = new Array<unknown>(length);
  let node = head;
  let index = 0;
  while (node !== null) {
    values[index] = node.value;
    node = node.next;
    index++;
  }
  return values;
}

type Target = "stdout" | "stderr";

/**
 * The `console.log` family over a pair of streams.
 *
 * Public operations are arrow-valued fields, so that `const { log } = console`
 * and `[1, 2].forEach(console.log)` both retain their receiver without a
 * constructor-time binding pass or prototype inspection.
 */
export class Console {
  _stdout: WritableLike;
  _stderr: WritableLike;
  _ignoreErrors: boolean;
  _stdoutErrorHandler: (err?: Error | null) => void;
  _stderrErrorHandler: (err?: Error | null) => void;
  /** Node exposes the timer table; its own tests read it. */
  _times: Map<string, Timestamp>;

  #counts = new Map<string, number>();
  #colorMode: boolean | "auto" = "auto";
  #inspectOptions: Map<WritableLike, InspectOptions> | undefined;
  #groupIndentWidth = 2;
  #groupIndent = "";

  constructor(options: ConsoleOptions);
  constructor(stdout: WritableLike, stderr?: WritableLike, ignoreErrors?: boolean);
  constructor(
    options: ConsoleConstructorOptions | WritableLike | null | undefined,
    maybeStderr?: WritableLike,
    maybeIgnoreErrors?: boolean,
  ) {
    // `new Console(out, err)` predates the options object and is still the
    // spelling most code uses. A stream is told apart from an options bag by
    // having a `write` method, which is node's own test.
    let opts: ConsoleConstructorOptions;
    if (isWritableLike(options)) {
      opts = {
        stdout: options,
        stderr: maybeStderr,
        ignoreErrors: maybeIgnoreErrors,
      };
    } else {
      if (options === null || options === undefined) {
        throw new ERR_CONSOLE_WRITABLE_STREAM("stdout");
      }
      opts = options;
    }

    const {
      stdout: out,
      stderr: err = out,
      ignoreErrors = true,
      colorMode = "auto",
      inspectOptions,
      groupIndentation,
    } = opts;

    if (!isWritableLike(out)) {
      throw new ERR_CONSOLE_WRITABLE_STREAM("stdout");
    }
    if (!isWritableLike(err)) {
      throw new ERR_CONSOLE_WRITABLE_STREAM("stderr");
    }

    validateOneOf(colorMode, "colorMode", ["auto", true, false]);

    if (groupIndentation !== undefined) {
      validateInteger(groupIndentation, "groupIndentation", 0, kMaxGroupIndentation);
    }

    if (inspectOptions !== undefined) {
      validateObject(inspectOptions, "options.inspectOptions");

      const perStream = inspectOptions instanceof Map
        ? inspectOptions
        : new Map<WritableLike, InspectOptions>([
            [out, inspectOptions],
            [err, inspectOptions],
          ]);

      for (const streamOptions of perStream.values()) {
        // Both say what colour to use, and there is no sensible tie-break.
        if (streamOptions.colors !== undefined && opts.colorMode !== undefined) {
          throw new ERR_INCOMPATIBLE_OPTION_PAIR("options.inspectOptions.color", "colorMode");
        }
      }
      this.#inspectOptions = perStream;
    }

    this._stdout = out;
    this._stderr = err;
    this._stdoutErrorHandler = createWriteErrorHandler(this, "stdout");
    this._stderrErrorHandler = createWriteErrorHandler(this, "stderr");
    this._ignoreErrors = Boolean(ignoreErrors);
    this._times = new Map<string, Timestamp>();
    this.#colorMode = colorMode;
    this.#groupIndentWidth = groupIndentation ?? 2;
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

  log = (...args: unknown[]): void => {
    if (onLog.hasSubscribers) {
      onLog.publish(args);
    }
    this.#writeToConsole("stdout", this.#format("stdout", args));
  };

  info = (...args: unknown[]): void => {
    if (onInfo.hasSubscribers) {
      onInfo.publish(args);
    }
    this.#writeToConsole("stdout", this.#format("stdout", args));
  };

  debug = (...args: unknown[]): void => {
    if (onDebug.hasSubscribers) {
      onDebug.publish(args);
    }
    this.#writeToConsole("stdout", this.#format("stdout", args));
  };

  dirxml = this.log;

  warn = (...args: unknown[]): void => {
    if (onWarn.hasSubscribers) {
      onWarn.publish(args);
    }
    this.#writeToConsole("stderr", this.#format("stderr", args));
  };

  error = (...args: unknown[]): void => {
    if (onError.hasSubscribers) {
      onError.publish(args);
    }
    this.#writeToConsole("stderr", this.#format("stderr", args));
  };

  /** One value inspected. Format specifiers are not interpreted. */
  dir = (object: unknown, options?: InspectOptions): void => {
    this.#writeToConsole("stdout", inspect(object, {
      customInspect: false,
      ...this.#getInspectOptions(this._stdout),
      ...options,
    }));
  };

  /** The message with a stack trace under it, on stderr. */
  trace = (...args: unknown[]): void => {
    const err = {
      name: "Trace",
      message: this.#format("stderr", args),
      stack: "",
    };
    // The frames start below `trace` itself: the caller wants to know where it
    // called from, not that it went through `console`.
    captureStackTrace(err, this.trace);
    this.error(err.stack);
  };

  /** https://console.spec.whatwg.org/#assert -- reports, never throws. */
  assert = (expression?: unknown, ...args: unknown[]): void => {
    if (!expression) {
      if (args.length > 0 && typeof args[0] === "string") {
        args[0] = `Assertion failed: ${args[0]}`;
        this.warn(...args);
      } else {
        this.warn("Assertion failed", ...args);
      }
    }
  };

  /** https://console.spec.whatwg.org/#clear -- a no-op unless stdout is a TTY. */
  clear = (): void => {
    if (this._stdout.isTTY && nts_process_env("TERM") !== "dumb") {
      cursorTo(this._stdout, 0, 0);
      clearScreenDown(this._stdout);
    }
  };

  // ------------------------------------------------------------- counting

  /** https://console.spec.whatwg.org/#count */
  count = (label: string = "default"): void => {
    // Coerces anything but a symbol, which throws -- as it should, since a
    // symbol has no string form and a count table is keyed by strings.
    label = `${label}`;
    const count = (this.#counts.get(label) ?? 0) + 1;
    this.#counts.set(label, count);
    this.log(`${label}: ${count}`);
  };

  /** https://console.spec.whatwg.org/#countreset */
  countReset = (label: string = "default"): void => {
    if (!this.#counts.has(label)) {
      emitWarning(`Count for '${label}' does not exist`, "Warning", "");
      return;
    }
    this.#counts.delete(`${label}`);
  };

  // --------------------------------------------------------------- timing

  time = (label: string = "default"): void => {
    time(this._times, "console.time()", `${label}`);
  };

  timeEnd = (label: string = "default"): void => {
    timeEnd(this._times, "console.timeEnd()", this.#timeLogImpl, `${label}`);
  };

  timeLog = (label: string = "default", ...data: unknown[]): void => {
    timeLog(this._times, "console.timeLog()", this.#timeLogImpl, `${label}`, data);
  };

  #timeLogImpl = (label: string, formatted: string, args?: unknown[]): void => {
    if (args === undefined) {
      this.log("%s: %s", label, formatted);
    } else {
      this.log("%s: %s", label, formatted, ...args);
    }
  };

  // ------------------------------------------------------------- grouping

  group = (...data: unknown[]): void => {
    if (data.length > 0) {
      this.log(...data);
    }
    this.#groupIndent += " ".repeat(this.#groupIndentWidth);
  };

  groupCollapsed = this.group;

  groupEnd = (): void => {
    this.#groupIndent = this.#groupIndent.slice(
      0,
      this.#groupIndent.length - this.#groupIndentWidth,
    );
  };

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
  table = (tabularData: unknown, properties?: readonly string[]): void => {
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
        Object.keys(v).length > 2 ? -1 : 0;
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
    let fromMapIterator = false;
    let isKeyValue = false;
    if (isMapIterator(data)) {
      // A map iterator yields entries, and the pairs are what to tabulate.
      const entries = collectIterable(data);
      fromMapIterator = true;
      isKeyValue = entries.every(isPair);
      data = entries;
    }

    if (isKeyValue && Array.isArray(data) && data.every(isPair)) {
      const length = data.length;
      const keys = new Array<string>(length);
      const values = new Array<string>(length);
      for (let index = 0; index < length; index++) {
        const entry = data[index];
        if (entry === undefined) continue;
        keys[index] = _inspect(entry[0]);
        values[index] = _inspect(entry[1]);
      }
      final([iterKey, keyKey, valuesKey], [getIndexArray(length), keys, values]);
      return;
    }

    if (isMap(data)) {
      const length = data.size;
      const keys = new Array<string>(length);
      const values = new Array<string>(length);
      let index = 0;
      for (const [key, value] of data) {
        keys[index] = _inspect(key);
        values[index] = _inspect(value);
        index++;
      }
      final([iterKey, keyKey, valuesKey], [getIndexArray(length), keys, values]);
      return;
    }

    let fromSetIterator = false;
    if (isSetIterator(data)) {
      fromSetIterator = true;
      data = collectIterable(data);
    }

    if ((fromSetIterator || fromMapIterator) && Array.isArray(data)) {
      const length = data.length;
      const values = new Array<string>(length);
      for (let index = 0; index < length; index++) {
        values[index] = _inspect(data[index]);
      }
      final([iterKey, valuesKey], [getIndexArray(length), values]);
      return;
    }

    if (isSet(data)) {
      const length = data.size;
      const values = new Array<string>(length);
      let index = 0;
      for (const value of data) {
        values[index] = _inspect(value);
        index++;
      }
      final([iterKey, valuesKey], [getIndexArray(length), values]);
      return;
    }

    if (!isPropertyRecord(data)) {
      this.log(data);
      return;
    }

    const columns = new Map<string, string[]>();
    let hasPrimitives = false;
    const indexKeyArray = Object.keys(data);
    const valuesKeyArray = new Array<string>(indexKeyArray.length);

    for (let i = 0; i < indexKeyArray.length; i++) {
      const index = indexKeyArray[i];
      if (index === undefined) continue;
      const item = data[index];
      const primitive = item === null ||
        (typeof item !== "function" && typeof item !== "object");
      if (properties === undefined && primitive) {
        hasPrimitives = true;
        valuesKeyArray[i] = _inspect(item);
      } else {
        const keys = properties ?? (isPropertyRecord(item) ? Object.keys(item) : []);
        for (const key of keys) {
          let column = columns.get(key);
          if (column === undefined) {
            column = new Array<string>(indexKeyArray.length);
            columns.set(key, column);
          }
          if (!isPropertyRecord(item) || !Object.hasOwn(item, key)) {
            column[i] = "";
          } else {
            column[i] = _inspect(item[key]);
          }
        }
      }
    }

    const resultLength = columns.size + (hasPrimitives ? 2 : 1);
    const keys = new Array<string>(resultLength);
    const values = new Array<string[]>(resultLength);
    keys[0] = indexKey;
    values[0] = indexKeyArray;
    let resultIndex = 1;
    for (const [key, column] of columns) {
      keys[resultIndex] = key;
      values[resultIndex] = column;
      resultIndex++;
    }
    if (hasPrimitives) {
      keys[resultIndex] = valuesKey;
      values[resultIndex] = valuesKeyArray;
    }

    final(keys, values);
  };

  // Timeline markers, so that code written for a browser runs unchanged.
  // Node's are no-ops too.
  profile = noop;
  profileEnd = noop;
  timeStamp = noop;
}

const keyKey = "Key";
const valuesKey = "Values";
const indexKey = "(index)";
const iterKey = "(iteration index)";

/** What `console.table` counts as a list rather than a record. */
function isArrayLike(v: unknown): boolean {
  return Array.isArray(v) || isTypedArray(v);
}

function isWritableLike(
  value: ConsoleConstructorOptions | WritableLike | null | undefined,
): value is WritableLike {
  return value !== null && value !== undefined && typeof value.write === "function";
}

/** A JavaScript value on which a string-key read is defined. */
function isPropertyRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

function isPair(value: unknown): value is [unknown, unknown] {
  return Array.isArray(value) && value.length === 2;
}

/**
 * V8 reports a blown stack as a plain `RangeError` with this message. There is
 * no code to test, so the message is the test -- node does the same.
 */
function isStackOverflowError(err: unknown): boolean {
  return err instanceof RangeError &&
    err.message === "Maximum call stack size exceeded";
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

/**
 * The global `console`.
 *
 * Node builds a prototype-less namespace and customizes `instanceof`; both are
 * §13 object-model operations. A real instance gives typed code the same
 * methods, state, detached-call behavior and `instanceof Console` answer.
 */
export const globalConsole: Console = new Console({
  stdout: stdio.stdout,
  stderr: stdio.stderr,
});

export { Console as Console_, formatTime };
export default globalConsole;
