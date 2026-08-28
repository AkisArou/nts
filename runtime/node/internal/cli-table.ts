// The box-drawing table, from node v24.20.0 `lib/internal/cli_table.js`.
//
// `console.table` decides *what* the columns are; this decides how wide they
// are and draws the borders. Widths are in terminal columns, not code units,
// which is why it goes through `getStringWidth`.

import { getStringWidth } from "../util/src/width.ts";

const tableChars = {
  middleMiddle: "─",
  rowMiddle: "┼",
  topRight: "┐",
  topLeft: "┌",
  leftMiddle: "├",
  topMiddle: "┬",
  bottomRight: "┘",
  bottomLeft: "└",
  bottomMiddle: "┴",
  rightMiddle: "┤",
  left: "│ ",
  right: " │",
  middle: " │ ",
} as const;

function renderRow(row: readonly string[], columnWidths: readonly number[]): string {
  let out: string = tableChars.left;
  for (let i = 0; i < row.length; i++) {
    const cell = row[i]!;
    const needed = columnWidths[i]! - getStringWidth(cell);
    out += cell + " ".repeat(Math.ceil(needed));
    if (i !== row.length - 1) {
      out += tableChars.middle;
    }
  }
  out += tableChars.right;
  return out;
}

/**
 * A table with `head` as its header row and `columns[i]` as column `i`.
 *
 * Columns need not be the same length; a short one is padded with empty cells,
 * which is what makes a heterogeneous array of objects printable.
 */
export function cliTable(head: readonly string[], columns: readonly string[][]): string {
  const rows: string[][] = [];
  const columnWidths = head.map((h) => getStringWidth(h));
  const longestColumn = Math.max(...columns.map((a) => a.length));

  for (let i = 0; i < head.length; i++) {
    const column = columns[i]!;
    for (let j = 0; j < longestColumn; j++) {
      rows[j] ??= [];
      // A hole in a sparse column is an empty cell, not `undefined`: the
      // column arrays `console.table` builds are indexed by row and are sparse
      // whenever a row lacks that key.
      const value = rows[j]![i] = Object.hasOwn(column, j) ? column[j]! : "";
      columnWidths[i] = Math.max(columnWidths[i] ?? 0, getStringWidth(value));
    }
  }

  const divider = columnWidths.map((i) => tableChars.middleMiddle.repeat(i + 2));

  let result = tableChars.topLeft +
    divider.join(tableChars.topMiddle) +
    tableChars.topRight + "\n" +
    renderRow(head, columnWidths) + "\n" +
    tableChars.leftMiddle +
    divider.join(tableChars.rowMiddle) +
    tableChars.rightMiddle + "\n";

  for (const row of rows) {
    result += `${renderRow(row, columnWidths)}\n`;
  }

  result += tableChars.bottomLeft +
    divider.join(tableChars.bottomMiddle) +
    tableChars.bottomRight;

  return result;
}
