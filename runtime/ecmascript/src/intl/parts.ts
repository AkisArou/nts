// Stable provider field codes match UNumberFormatFields. ICU4J maps its Field
// objects to these codes once in its adapter; shared code owns JS part names.
// Range parts include approximatelySign; range source attribution belongs to
// the range algorithm, not this single formatted-text partition.
const numberFields: readonly Intl.NumberRangeFormatPart["type"][] = [
  "integer",
  "fraction",
  "decimal",
  "exponentSeparator",
  "exponentMinusSign",
  "exponentInteger",
  "group",
  "currency",
  "percentSign",
  "literal",
  "minusSign",
  "unit",
  "compact",
  "approximatelySign",
];

export class FieldSpans {
  readonly fields: Int32Array;
  readonly starts: Int32Array;
  readonly ends: Int32Array;
  count = 0;
  constructor(capacity: number) {
    this.fields = new Int32Array(capacity);
    this.starts = new Int32Array(capacity);
    this.ends = new Int32Array(capacity);
  }
}

// Reused per formatter. The hot format() path never constructs parts or this
// scratch buffer. formatToParts allocates only the returned JS objects/strings
// once capacity is sufficient, and allocates their array to its exact size.
export class NumberPartBuffer {
  private cells = new Int16Array(64);
  partition(
    text: string,
    spans: FieldSpans,
    negative: boolean,
    nan: boolean,
    infinity: boolean,
  ): Omit<Intl.NumberRangeFormatPart, "source">[] {
    if (this.cells.length < text.length)
      this.cells = new Int16Array(Math.max(text.length, this.cells.length * 2));
    this.cells.fill(0, 0, text.length);
    for (let span = 0; span < spans.count; span++) {
      const field = spans.fields[span]!;
      const start = spans.starts[span]!;
      const end = spans.ends[span]!;
      if (
        field < 0 ||
        field >= numberFields.length ||
        start < 0 ||
        end > text.length ||
        end < start
      )
        throw new RangeError("Invalid provider field span");
      for (let index = start; index < end; index++) {
        // INTEGER encloses grouping fields. Never overwrite a more specific
        // field, regardless of the order an ICU provider enumerates spans.
        if (field !== 0 || this.cells[index] === 0) this.cells[index] = field + 1;
      }
    }
    let count = 0;
    for (let index = 0; index < text.length; index++)
      if (index === 0 || this.cells[index] !== this.cells[index - 1]) count++;
    const parts = new Array<Omit<Intl.NumberRangeFormatPart, "source">>(count);
    let from = 0;
    let output = 0;
    while (from < text.length) {
      const cell = this.cells[from]!;
      let to = from + 1;
      while (to < text.length && this.cells[to] === cell) to++;
      let type = cell === 0 ? "literal" : numberFields[cell - 1]!;
      if (cell === 1 && nan) type = "nan";
      else if (cell === 1 && infinity) type = "infinity";
      else if (cell === 11 && !negative) type = "plusSign";
      parts[output++] = { type, value: text.slice(from, to) };
      from = to;
    }
    return parts;
  }
}
