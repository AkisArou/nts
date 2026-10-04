// Stable provider field codes match UNumberFormatFields. ICU4J maps its Field
// objects to these codes once in its adapter; shared code owns JS part names.
// Range parts include approximatelySign; range source attribution belongs to
// the range algorithm, not this single formatted-text partition.
const numberFields: readonly Intl.NumberFormatPart["type"][] = [
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
  private sources = new Uint8Array(0);
  private read(text: string, spans: FieldSpans, range: boolean): void {
    if (this.cells.length < text.length)
      this.cells = new Int16Array(Math.max(text.length, this.cells.length * 2));
    if (range && this.sources.length < text.length)
      this.sources = new Uint8Array(this.cells.length);
    this.cells.fill(0, 0, text.length);
    if (range) this.sources.fill(0, 0, text.length);
    for (let span = 0; span < spans.count; span++) {
      const field = spans.fields[span]!;
      const start = spans.starts[span]!;
      const end = spans.ends[span]!;
      if (
        field < 0 ||
        field >= (range ? 16 : numberFields.length) ||
        start < 0 ||
        end > text.length ||
        end < start
      )
        throw new RangeError("Invalid provider field span");
      for (let index = start; index < end; index++) {
        // 14/15 are ICU's start/end range spans, rather than number fields.
        if (field >= 14) this.sources[index] = field - 13;
        else if (field !== 0 || this.cells[index] === 0) this.cells[index] = field + 1;
      }
    }
  }

  private type(
    cell: number,
    negative: boolean,
    nan: boolean,
    infinity: boolean,
    percentUnit: boolean,
  ): Intl.NumberFormatPart["type"] {
    if (cell === 0) return "literal";
    if (cell === 1 && nan) return "nan";
    if (cell === 1 && infinity) return "infinity";
    if (cell === 11 && !negative) return "plusSign";
    if (cell === 9 && percentUnit) return "unit";
    return numberFields[cell - 1]!;
  }
  partition(
    text: string,
    spans: FieldSpans,
    negative: boolean,
    nan: boolean,
    infinity: boolean,
    percentUnit = false,
  ): Pick<Intl.NumberFormatPart, "type" | "value">[] {
    this.read(text, spans, false);
    let count = 0;
    for (let index = 0; index < text.length; index++)
      if (index === 0 || this.cells[index] !== this.cells[index - 1]) count++;
    const parts = new Array<Pick<Intl.NumberFormatPart, "type" | "value">>(count);
    let from = 0;
    let output = 0;
    while (from < text.length) {
      const cell = this.cells[from]!;
      let to = from + 1;
      while (to < text.length && this.cells[to] === cell) to++;
      const type = this.type(cell, negative, nan, infinity, percentUnit);
      parts[output++] = { type, value: text.slice(from, to) };
      from = to;
    }
    return parts;
  }

  partitionRange(
    text: string,
    spans: FieldSpans,
    startNegative: boolean,
    endNegative: boolean,
    startInfinity: boolean,
    endInfinity: boolean,
    percentUnit = false,
  ): Pick<Intl.NumberRangeFormatPart, "type" | "value" | "source">[] {
    this.read(text, spans, true);
    let count = 0;
    for (let index = 0; index < text.length; index++)
      if (
        index === 0 ||
        this.cells[index] !== this.cells[index - 1] ||
        this.sources[index] !== this.sources[index - 1]
      )
        count++;
    const parts = new Array<Pick<Intl.NumberRangeFormatPart, "type" | "value" | "source">>(count);
    let from = 0;
    let output = 0;
    while (from < text.length) {
      const cell = this.cells[from]!;
      const source = this.sources[from]!;
      let to = from + 1;
      while (to < text.length && this.cells[to] === cell && this.sources[to] === source) to++;
      const negative = source === 2 ? endNegative : startNegative;
      const infinity = source === 2 ? endInfinity : startInfinity;
      parts[output++] = {
        type:
          cell === 14
            ? "approximatelySign"
            : this.type(cell, negative, false, infinity, percentUnit),
        value: text.slice(from, to),
        source: source === 1 ? "startRange" : source === 2 ? "endRange" : "shared",
      };
      from = to;
    }
    return parts;
  }
}
