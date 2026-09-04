// `assert.AssertionError` and the diff it carries, from node v24.20.0
// `lib/internal/assert/assertion_error.js`.
//
// The message is the product here. An assertion that fails and says only
// "failed" costs the reader a debugging session; one that shows which line of
// a structure differs costs them a glance. Almost all of this file is about
// choosing the shortest true description of a difference:
//
//   two short primitives     `1 !== 2`, inline
//   two long strings         a character diff with a caret under the first
//                            character that differs
//   two structures           a line diff, unchanged runs collapsed
//   structurally equal       one copy, and a note that they are not the same
//                            object
//
// The choice is what makes it useful, so it is made here rather than left to
// whoever reads the output.

import { inspect } from "../../util/src/inspect.ts";
import { colors, refresh } from "../../internal/colors.ts";
import { validateObject } from "../../internal/validators.ts";
import { captureStackTrace } from "../../internal/errors.ts";
import { myersDiff, printMyersDiff, printSimpleMyersDiff } from "../../internal/assert/myers-diff.ts";
import { stderr } from "../../internal/stdio.ts";

/** How each statically known operator words its failure. */
function readableOperator(operator: string): string | undefined {
  switch (operator) {
    case "deepStrictEqual":
      return "Expected values to be strictly deep-equal:";
    case "partialDeepStrictEqual":
      return "Expected values to be partially and strictly deep-equal:";
    case "strictEqual":
      return "Expected values to be strictly equal:";
    case "strictEqualObject":
      return 'Expected "actual" to be reference-equal to "expected":';
    case "deepEqual":
      return "Expected values to be loosely deep-equal:";
    case "notDeepStrictEqual":
      return 'Expected "actual" not to be strictly deep-equal to:';
    case "notStrictEqual":
      return 'Expected "actual" to be strictly unequal to:';
    case "notStrictEqualObject":
      return 'Expected "actual" not to be reference-equal to "expected":';
    case "notDeepEqual":
      return 'Expected "actual" not to be loosely deep-equal to:';
    case "notIdentical":
      return "Values have same structure but are not reference-equal:";
    case "notDeepEqualUnequal":
      return "Expected values not to be loosely deep-equal:";
    default:
      return undefined;
  }
}

/** Short enough that `a !== b` on one line beats a two-line diff. */
const kMaxShortStringLength = 12;
/** Beyond this a generated comparison message is shortened. */
const kMaxLongStringLength = 512;

/** The operators whose message embeds a diff even when a custom one is given. */
function customMessageIncludesDiff(operator: string): boolean {
  return operator === "deepStrictEqual" ||
    operator === "strictEqual" ||
    operator === "partialDeepStrictEqual";
}

export type DiffMode = "simple" | "full";

export interface AssertionErrorDetail {
  message?: string;
  actual?: unknown;
  expected?: unknown;
  operator?: string;
  stack?: string;
}

export interface AssertionErrorOptions {
  message?: string | Error | undefined;
  actual?: unknown;
  expected?: unknown;
  operator?: string;
  stackStartFn?: CallableFunction;
  /** Older spelling of `stackStartFn`, still accepted. */
  stackStartFunction?: CallableFunction;
  details?: AssertionErrorDetail[];
  diff?: DiffMode;
}

/**
 * The statically observable part of an error used in a comparison message.
 *
 * Two errors that fail a comparison are inspected into the message, and an
 * error inspects as its stack -- which would put two irrelevant stacks in the
 * output. A copy carries everything the comparison was about and no stack.
 */
interface ErrorSnapshot {
  readonly name: string;
  readonly message: string;
  readonly cause?: unknown;
}

function copyError(source: Error): ErrorSnapshot {
  const cause = source.cause instanceof Error ? copyError(source.cause) : source.cause;
  if (cause === undefined) return { name: source.name, message: source.message };
  return { name: source.name, message: source.message, cause };
}

/**
 * The settings the diff inspects with.
 *
 * Fixed rather than taken from `util.inspect.defaultOptions`, because a
 * program that set `depth: 0` globally would otherwise get assertion messages
 * that do not say what differs. `compact: false` is the important one: one
 * entry per line is what makes a line diff able to point at a single entry.
 */
function inspectValue(value: unknown): string {
  return inspect(value, {
    compact: false,
    customInspect: false,
    depth: 1000,
    maxArrayLength: Infinity,
    // Assert compares only enumerable properties, with a few exceptions.
    showHidden: false,
    sorted: true,
    // Inspected because they are compared: a getter's value is part of the
    // comparison, so it has to be part of the message.
    getters: true,
  });
}

function getErrorMessage(operator: string, message: string | undefined): string {
  return message || readableOperator(operator) || "";
}

/**
 * `strictEqual` on two objects can only have failed on identity, since a
 * structural difference would have been reported as one. Saying so is more
 * use than showing two identical-looking values.
 */
function checkOperator(actual: unknown, expected: unknown, operator: string): string {
  if (
    operator === "strictEqual" &&
    ((typeof actual === "object" && actual !== null &&
      typeof expected === "object" && expected !== null) ||
      (typeof actual === "function" && typeof expected === "function"))
  ) {
    return "strictEqualObject";
  }
  return operator;
}

/** Two strings, diffed by character and run together on one line. */
function getColoredMyersDiff(actual: string, expected: string): {
  message: string;
  header: string;
  skipped: boolean;
} {
  const header = `${colors.green}actual${colors.white} ${colors.red}expected${colors.white}`;
  const diff = myersDiff(actual.split(""), expected.split(""));
  const message = printSimpleMyersDiff(diff);
  return { message, header, skipped: false };
}

/**
 * Both values on their own line, with a caret under the first character that
 * differs.
 *
 * The caret is only drawn for two strings that fit the terminal: past that it
 * points at a column the reader cannot see. The first two characters are
 * skipped because a difference there is already obvious -- three, to allow for
 * the opening quote.
 */
function getStackedDiff(actual: string, expected: string, isStringComparison: boolean): {
  message: string;
} {
  let message = `\n${colors.green}+${colors.white} ${actual}\n${colors.red}- ${colors.white}${expected}`;
  const stringsLen = actual.length + expected.length;
  const maxTerminalLength = stderr.isTTY ? stderr.columns ?? 80 : 80;
  const showIndicator = isStringComparison && stringsLen <= maxTerminalLength;

  if (showIndicator) {
    let indicatorIdx = -1;

    for (let i = 0; i < actual.length; i++) {
      if (actual[i] !== expected[i]) {
        if (i >= 3) {
          indicatorIdx = i;
        }
        break;
      }
    }

    if (indicatorIdx !== -1) {
      message += `\n${" ".repeat(indicatorIdx + 2)}^`;
    }
  }

  return { message };
}

function getSimpleDiff(
  originalActual: unknown,
  actual: string,
  originalExpected: unknown,
  expected: string,
): { message: string; header?: string; skipped?: boolean } {
  let stringsLen = actual.length + expected.length;
  // The quotes are part of the rendering, not of the value.
  if (typeof originalActual === "string") {
    stringsLen -= 2;
  }
  if (typeof originalExpected === "string") {
    stringsLen -= 2;
  }
  // `0 !== -0` is the one short pair that has to be stacked, because inline it
  // would read as two identical values.
  if (stringsLen <= kMaxShortStringLength && (originalActual !== 0 || originalExpected !== 0)) {
    return { message: `${actual} !== ${expected}`, header: "" };
  }

  const isStringComparison = typeof originalActual === "string" && typeof originalExpected === "string";
  if (isStringComparison && colors.hasColors) {
    return getColoredMyersDiff(actual, expected);
  }

  return getStackedDiff(actual, expected, isStringComparison);
}

/** One line each, and at least one side a primitive: nothing to diff line-wise. */
function isSimpleDiff(
  actual: unknown,
  inspectedActual: readonly string[],
  expected: unknown,
  inspectedExpected: readonly string[],
): boolean {
  if (inspectedActual.length > 1 || inspectedExpected.length > 1) {
    return false;
  }
  return typeof actual !== "object" || actual === null ||
    typeof expected !== "object" || expected === null;
}

export function createErrDiff(
  actual: unknown,
  expected: unknown,
  operator: string,
  customMessage: string | undefined,
  diffType: DiffMode = "simple",
): string {
  operator = checkOperator(actual, expected, operator);

  let skipped = false;
  let message = "";
  const inspectedActual = inspectValue(actual);
  const inspectedExpected = inspectValue(expected);
  const inspectedSplitActual = inspectedActual.split("\n");
  const inspectedSplitExpected = inspectedExpected.split("\n");
  const showSimpleDiff = isSimpleDiff(actual, inspectedSplitActual, expected, inspectedSplitExpected);
  let header = `${colors.green}+ actual${colors.white} ${colors.red}- expected${colors.white}`;

  if (showSimpleDiff) {
    const firstActual = inspectedSplitActual[0] ?? "";
    const firstExpected = inspectedSplitExpected[0] ?? "";
    const simpleDiff = getSimpleDiff(
      actual, firstActual, expected, firstExpected,
    );
    message = simpleDiff.message;
    if (simpleDiff.header !== undefined) {
      header = simpleDiff.header;
    }
    if (simpleDiff.skipped) {
      skipped = true;
    }
  } else if (inspectedActual === inspectedExpected) {
    // Structurally the same, so the comparison must have failed on identity.
    // One copy, and a heading that says so.
    operator = "notIdentical";
    if (inspectedSplitActual.length > 50 && diffType !== "full") {
      message = `${inspectedSplitActual.slice(0, 50).join("\n")}\n...}`;
      skipped = true;
    } else {
      message = inspectedSplitActual.join("\n");
    }
    header = "";
  } else {
    // An inspected object puts a comma after every entry but the last, so an
    // insertion at the end also changes the line before it. Telling the diff
    // about that keeps one change from reading as two.
    const checkCommaDisparity = actual != null && typeof actual === "object";
    const diff = myersDiff(inspectedSplitActual, inspectedSplitExpected, checkCommaDisparity);

    const myersDiffMessage = printMyersDiff(diff, operator);
    message = myersDiffMessage.message;

    if (operator === "partialDeepStrictEqual") {
      header = `${colors.gray}${colors.hasColors ? "" : "+ "}actual${colors.white} ${colors.red}- expected${colors.white}`;
    }

    if (myersDiffMessage.skipped) {
      skipped = true;
    }
  }

  const headerMessage = `${getErrorMessage(operator, customMessage)}\n${header}`;
  const skippedMessage = skipped ? "\n... Skipped lines" : "";

  return `${headerMessage}${skippedMessage}\n${message}\n`;
}

export class AssertionError extends Error {
  generatedMessage: boolean;
  code = "ERR_ASSERTION";
  actual: unknown;
  expected: unknown;
  operator: string | undefined;
  diff: DiffMode;
  readonly details: readonly AssertionErrorDetail[] | undefined;

  constructor(options: AssertionErrorOptions) {
    validateObject(options, "options");
    const {
      message,
      operator = "",
      stackStartFn,
      details,
      stackStartFunction,
      diff = "simple",
    } = options;
    let { actual, expected } = options;

    let built: string;

    if (message != null) {
      // A custom message replaces the heading, not the diff: the reader still
      // needs to see what differed.
      built = customMessageIncludesDiff(operator)
        ? createErrDiff(actual, expected, operator, String(message), diff)
        : String(message);
    } else {
      // Re-read on every call: an environment variable can change under a
      // long-running process, and a message built with stale colours is
      // either unreadable or full of escape sequences.
      refresh();

      // Two errors would each inspect as their own stack, which is three
      // stacks in one message and none of them the one that matters.
      if (
        typeof actual === "object" && actual !== null &&
        typeof expected === "object" && expected !== null &&
        "stack" in actual && actual instanceof Error &&
        "stack" in expected && expected instanceof Error
      ) {
        actual = copyError(actual);
        expected = copyError(expected);
      }

      if (customMessageIncludesDiff(operator)) {
        built = createErrDiff(actual, expected, operator, undefined, diff);
      } else if (operator === "notDeepStrictEqual" || operator === "notStrictEqual") {
        // The two are equal and were required not to be, so there is nothing
        // to diff: one value, and what was wrong with it.
        let base = readableOperator(operator) ?? "";
        const res = inspectValue(actual).split("\n");

        if (
          operator === "notStrictEqual" &&
          ((typeof actual === "object" && actual !== null) || typeof actual === "function")
        ) {
          base = readableOperator("notStrictEqualObject") ?? "";
        }

        if (res.length > 50 && diff !== "full") {
          res[46] = `${colors.blue}...${colors.white}`;
          while (res.length > 47) {
            res.pop();
          }
        }

        const first = res[0] ?? "";
        built = res.length === 1
          ? `${base}${first.length > 5 ? "\n\n" : " "}${first}`
          : `${base}\n\n${res.join("\n")}\n`;
      } else {
        let res = inspectValue(actual);
        let other = inspectValue(expected);
        const knownOperator = readableOperator(operator);
        if (operator === "notDeepEqual" && res === other) {
          res = `${knownOperator}\n\n${res}`;
          if (res.length > 1024 && diff !== "full") {
            res = `${res.slice(0, 1021)}...`;
          }
          built = res;
        } else {
          if (res.length > kMaxLongStringLength && diff !== "full") {
            res = `${res.slice(0, 509)}...`;
          }
          if (other.length > kMaxLongStringLength && diff !== "full") {
            other = `${other.slice(0, 509)}...`;
          }
          if (operator === "deepEqual") {
            res = `${knownOperator}\n\n${res}\n\nshould loosely deep-equal\n\n`;
          } else {
            const newOp = operator === "notDeepEqual"
              ? readableOperator("notDeepEqualUnequal")
              : undefined;
            if (newOp) {
              res = `${newOp}\n\n${res}\n\nshould not loosely deep-equal\n\n`;
            } else {
              other = ` ${operator} ${other}`;
            }
          }
          built = `${res}${other}`;
        }
      }
    }

    super(built);

    this.generatedMessage = !message;
    // The code is in the name while the stack is captured, so the first line
    // of a printed stack carries it, and taken back out afterwards so that
    // `err.name` is the plain one. Property-descriptor flags are deliberately
    // not modelled by the compiled object representation.
    this.name = "AssertionError [ERR_ASSERTION]";
    this.code = "ERR_ASSERTION";
    this.details = details;
    if (details) {
      // Node also materialises dynamically named properties such as
      // `"actual 0"`. A flat typed object has no property map, so the same
      // information is retained as a statically typed list.
      this.actual = undefined;
      this.expected = undefined;
      this.operator = undefined;
    } else {
      this.actual = actual;
      this.expected = expected;
      this.operator = operator;
    }
    // Everything inside `assert` is hidden, so the top frame is the line the
    // reader wrote rather than the line that threw.
    captureStackTrace(this, stackStartFn ?? stackStartFunction);
    // Materialise the stack while the name still carries the code.
    void this.stack;
    this.name = "AssertionError";
    this.diff = diff;
  }

  override toString(): string {
    return `${this.name} [${this.code}]: ${this.message}`;
  }
}
