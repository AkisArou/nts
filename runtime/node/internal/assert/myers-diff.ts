// The diff behind a failed assertion, from node v24.20.0
// `lib/internal/assert/myers_diff.js`.
//
// Myers' algorithm finds the shortest edit script between two sequences: the
// fewest insertions and deletions that turn one into the other. That is what
// makes an assertion failure readable -- a naive line-by-line comparison of
// two objects that differ by one inserted key reports every line after it as
// changed, and the reader has to find the one that matters.
//
// `d` counts edits. The algorithm walks `d` upwards and, for each, records how
// far along each diagonal it can reach; the first `d` that reaches the end is
// the answer, so the common case of two nearly-equal values is found in a few
// passes rather than a full matrix.

import { ERR_OUT_OF_RANGE } from "../errors.ts";
import { colors } from "../colors.ts";

/** Consecutive unchanged lines beyond this are collapsed to `...`. */
const kNopLinesToCollapse = 5;

export const kOperations = {
  DELETE: -1,
  NOP: 0,
  INSERT: 1,
} as const;

export type Operation = (typeof kOperations)[keyof typeof kOperations];
export type Edit = [Operation, string];

/**
 * Two lines are equal, optionally ignoring a trailing comma.
 *
 * Inspected objects put a comma after every entry but the last, so inserting a
 * key at the end changes the line before it as well. Treating `a: 1` and
 * `a: 1,` as the same line keeps that from showing up as two edits where there
 * was one.
 */
function areLinesEqual(actual: string, expected: string, checkCommaDisparity: boolean): boolean {
  if (actual === expected) {
    return true;
  }
  if (checkCommaDisparity) {
    return `${actual},` === expected || actual === `${expected},`;
  }
  return false;
}

/**
 * The shortest edit script from `actual` to `expected`, innermost edit first.
 *
 * Returned in reverse: the callers walk it backwards, which is the order the
 * backtrack produces and saves reversing an array that is only ever printed.
 */
export function myersDiff(
  actual: readonly string[],
  expected: readonly string[],
  checkCommaDisparity = false,
): Edit[] {
  const actualLength = actual.length;
  const expectedLength = expected.length;
  const max = actualLength + expectedLength;

  if (max > 2 ** 31 - 1) {
    throw new ERR_OUT_OF_RANGE("myersDiff input size", "< 2^31", max);
  }

  // `v[k + max]` is how far along diagonal `k` the search has reached. One
  // array reused across levels, with a copy kept per level for the backtrack.
  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];

  for (let diffLevel = 0; diffLevel <= max; diffLevel++) {
    trace.push(new Int32Array(v));

    for (let diagonalIndex = -diffLevel; diagonalIndex <= diffLevel; diagonalIndex += 2) {
      const offset = diagonalIndex + max;
      const previousOffset = v[offset - 1]!;
      const nextOffset = v[offset + 1]!;
      // Take whichever neighbouring diagonal reached further: down (an
      // insertion) or right (a deletion).
      let x = diagonalIndex === -diffLevel ||
        (diagonalIndex !== diffLevel && previousOffset < nextOffset)
        ? nextOffset
        : previousOffset + 1;
      let y = x - diagonalIndex;

      // Then run the free diagonal: matching lines cost nothing.
      while (
        x < actualLength &&
        y < expectedLength &&
        areLinesEqual(actual[x]!, expected[y]!, checkCommaDisparity)
      ) {
        x++;
        y++;
      }

      v[offset] = x;

      if (x >= actualLength && y >= expectedLength) {
        return backtrack(trace, actual, expected, checkCommaDisparity);
      }
    }
  }

  // Unreachable: `max` edits always suffice, since deleting everything and
  // inserting everything is an edit script.
  return [];
}

function backtrack(
  trace: readonly Int32Array[],
  actual: readonly string[],
  expected: readonly string[],
  checkCommaDisparity: boolean,
): Edit[] {
  const actualLength = actual.length;
  const expectedLength = expected.length;
  const max = actualLength + expectedLength;

  let x = actualLength;
  let y = expectedLength;
  const result: Edit[] = [];

  for (let diffLevel = trace.length - 1; diffLevel >= 0; diffLevel--) {
    const v = trace[diffLevel]!;
    const diagonalIndex = x - y;
    const offset = diagonalIndex + max;

    let prevDiagonalIndex: number;
    if (
      diagonalIndex === -diffLevel ||
      (diagonalIndex !== diffLevel && v[offset - 1]! < v[offset + 1]!)
    ) {
      prevDiagonalIndex = diagonalIndex + 1;
    } else {
      prevDiagonalIndex = diagonalIndex - 1;
    }

    const prevX = v[prevDiagonalIndex + max]!;
    const prevY = prevX - prevDiagonalIndex;

    while (x > prevX && y > prevY) {
      const actualItem = actual[x - 1]!;
      // Where the two lines differ only by a comma, print the expected
      // spelling: the comma belongs to the surrounding structure rather than
      // to the line, and showing the actual one would look like a difference.
      const value = checkCommaDisparity && !actualItem.endsWith(",")
        ? expected[y - 1]!
        : actualItem;
      result.push([kOperations.NOP, value]);
      x--;
      y--;
    }

    if (diffLevel > 0) {
      if (x > prevX) {
        result.push([kOperations.INSERT, actual[--x]!]);
      } else {
        result.push([kOperations.DELETE, expected[--y]!]);
      }
    }
  }

  return result;
}

/** A character-level diff, run together on one line. Used for two strings. */
export function printSimpleMyersDiff(diff: readonly Edit[]): string {
  let message = "";

  for (let diffIdx = diff.length - 1; diffIdx >= 0; diffIdx--) {
    const [operation, value] = diff[diffIdx]!;
    let color = colors.white;

    if (operation === kOperations.INSERT) {
      color = colors.green;
    } else if (operation === kOperations.DELETE) {
      color = colors.red;
    }

    message += `${color}${value}${colors.white}`;
  }

  return `\n${message}`;
}

/**
 * The line-oriented diff, with long runs of unchanged lines collapsed.
 *
 * `skipped` says whether anything was collapsed, so the caller can add the
 * "... Skipped lines" note -- a diff that silently omits lines reads as though
 * it showed everything.
 */
export function printMyersDiff(
  diff: readonly Edit[],
  operator: string,
): { message: string; skipped: boolean } {
  let message = "";
  let skipped = false;
  let nopCount = 0;

  for (let diffIdx = diff.length - 1; diffIdx >= 0; diffIdx--) {
    const [operation, value] = diff[diffIdx]!;
    const previousOperation = diffIdx < diff.length - 1 ? diff[diffIdx + 1]![0] : null;

    // Closing a run of unchanged lines. Collapsing is only worth it when it
    // saves more than it costs: one or two hidden lines are printed instead,
    // since `...` standing in for a single line helps nobody.
    if (previousOperation === kOperations.NOP && operation !== previousOperation) {
      if (nopCount === kNopLinesToCollapse + 1) {
        message += `${colors.white}  ${diff[diffIdx + 1]![1]}\n`;
      } else if (nopCount === kNopLinesToCollapse + 2) {
        message += `${colors.white}  ${diff[diffIdx + 2]![1]}\n`;
        message += `${colors.white}  ${diff[diffIdx + 1]![1]}\n`;
      } else if (nopCount >= kNopLinesToCollapse + 3) {
        message += `${colors.blue}...${colors.white}\n`;
        message += `${colors.white}  ${diff[diffIdx + 1]![1]}\n`;
        skipped = true;
      }
      nopCount = 0;
    }

    if (operation === kOperations.INSERT) {
      if (operator === "partialDeepStrictEqual") {
        // A partial comparison has no "extra" lines to accuse: everything in
        // `actual` that is not in `expected` is simply unexamined.
        message += `${colors.gray}${colors.hasColors ? " " : "+"} ${value}${colors.white}\n`;
      } else {
        message += `${colors.green}+${colors.white} ${value}\n`;
      }
    } else if (operation === kOperations.DELETE) {
      message += `${colors.red}-${colors.white} ${value}\n`;
    } else if (operation === kOperations.NOP) {
      if (nopCount < kNopLinesToCollapse) {
        message += `${colors.white}  ${value}\n`;
      }
      nopCount++;
    }
  }

  message = message.trimEnd();

  return { message: `\n${message}`, skipped };
}
