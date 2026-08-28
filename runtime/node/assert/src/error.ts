// `assert.AssertionError` and the diff it carries, node
// `lib/internal/assert/assertion_error.js`.
//
// The message is the product here. An assertion that fails and says only
// "failed" costs the reader a debugging session; one that shows which line of a
// structure differs costs them a glance. That is why node builds a line diff
// rather than printing both values, and why this does too.

import { inspect } from "../../util/src/inspect.ts";

export interface AssertionErrorOptions {
  message?: string | Error;
  actual?: unknown;
  expected?: unknown;
  operator?: string;
  stackStartFn?: (...args: never[]) => unknown;
}

export class AssertionError extends Error {
  readonly code = "ERR_ASSERTION";
  readonly generatedMessage: boolean;
  actual: unknown;
  expected: unknown;
  operator: string;

  constructor(options: AssertionErrorOptions) {
    const { actual, expected, operator = "" } = options;
    let message: string;
    let generated = false;

    if (options.message !== undefined) {
      message = options.message instanceof Error ? options.message.message : String(options.message);
    } else {
      generated = true;
      message = describe(actual, expected, operator);
    }

    super(message);
    this.name = "AssertionError";
    this.generatedMessage = generated;
    this.actual = actual;
    this.expected = expected;
    this.operator = operator;

    // Node hides the frames inside `assert` itself, so the top of the stack is
    // the line the reader wrote rather than the line that threw.
    if (options.stackStartFn !== undefined && "captureStackTrace" in Error) {
      (Error as unknown as { captureStackTrace(t: object, f: unknown): void })
        .captureStackTrace(this, options.stackStartFn);
    }
  }
}

/** How each operator words its failure, upstream `assertion_error.js`. */
function describe(actual: unknown, expected: unknown, operator: string): string {
  switch (operator) {
    case "strictEqual":
      return `Expected values to be strictly equal:\n\n${inspectFor(actual)} !== ${inspectFor(expected)}\n`;
    case "notStrictEqual":
      return `Expected "actual" to be strictly unequal to: ${inspectFor(expected)}`;
    case "deepStrictEqual":
      return `Expected values to be strictly deep-equal:\n${diff(actual, expected)}`;
    case "notDeepStrictEqual":
      return `Expected "actual" not to be strictly deep-equal to:\n\n${inspectFor(expected)}\n`;
    case "deepEqual":
      return `Expected values to be loosely deep-equal:\n\n${inspectFor(actual)}\n\nshould loosely deep-equal\n\n${inspectFor(expected)}`;
    case "notDeepEqual":
      return `Expected "actual" not to be loosely deep-equal to:\n\n${inspectFor(expected)}\n`;
    case "notEqual":
      return `${inspectFor(actual)} != ${inspectFor(expected)}`;
    case "fail":
      return "Failed";
    default:
      return `${inspectFor(actual)} ${operator} ${inspectFor(expected)}`;
  }
}

/**
 * The settings node's diff inspects with, upstream `assertion_error.js`.
 *
 * `compact: false` is the important one: every entry goes on its own line, so
 * a diff can mark the single line that differs. A compact rendering would put
 * a whole object on one line and the diff would then be "this whole line
 * changed", which is the output the diff exists to avoid.
 */
function inspectFor(value: unknown): string {
  return inspect(value, {
    compact: false,
    depth: 1000,
    maxArrayLength: Infinity,
    showHidden: false,
    breakLength: Infinity,
    sorted: true,
    getters: true,
  });
}

/**
 * A line diff of two inspected values.
 *
 * `+` is what was found, `-` what was wanted, and an unchanged line is shown
 * with two spaces so the columns line up. Node marks a run of identical lines
 * with `...` rather than printing all of them; that only matters for large
 * structures and is what makes the output readable when it does.
 */
function diff(actual: unknown, expected: unknown): string {
  const actualLines = inspectFor(actual).split("\n");
  const expectedLines = inspectFor(expected).split("\n");

  let out = "+ actual - expected\n\n";
  const max = Math.max(actualLines.length, expectedLines.length);
  let identical = 0;

  for (let i = 0; i < max; i++) {
    const a = actualLines[i];
    const e = expectedLines[i];
    if (a === e) {
      // A long run of identical lines is elided; three or fewer are cheaper to
      // print than to explain.
      identical++;
      if (identical > 3) {
        continue;
      }
      out += `  ${a}\n`;
      continue;
    }
    if (identical > 3) {
      out += `  ...\n`;
    }
    identical = 0;
    if (a !== undefined) {
      out += `+ ${a}\n`;
    }
    if (e !== undefined) {
      out += `- ${e}\n`;
    }
  }
  return out;
}
