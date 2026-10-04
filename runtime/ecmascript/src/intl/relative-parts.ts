import { FieldSpans } from "./parts.ts";

function numberType(field: number): Exclude<Intl.NumberFormatPartTypes, "literal"> {
  if (field === 0) return "integer";
  if (field === 1) return "fraction";
  if (field === 2) return "decimal";
  if (field === 6) return "group";
  throw new RangeError("Invalid relative number field");
}

export class RelativePartBuffer {
  #cells = new Uint8Array(64);
  partition(
    text: string,
    spans: FieldSpans,
    unit: Intl.RelativeTimeFormatUnitSingular,
  ): Intl.RelativeTimeFormatPart[] {
    if (this.#cells.length < text.length)
      this.#cells = new Uint8Array(Math.max(text.length, this.#cells.length * 2));
    this.#cells.fill(0, 0, text.length);
    for (let index = 0; index < spans.count; index++) {
      const field = spans.fields[index]!;
      const start = spans.starts[index]!;
      const end = spans.ends[index]!;
      if (field !== 14) numberType(field);
      if (start < 0 || end < start || end > text.length)
        throw new RangeError("Invalid relative field span");
      for (let at = start; at < end; at++) {
        const previous = this.#cells[at]!;
        if (field === 14) this.#cells[at] = previous | 128;
        else if (field !== 0 || (previous & 127) === 0)
          this.#cells[at] = (previous & 128) | (field + 1);
      }
    }
    let count = 0;
    for (let index = 0; index < text.length; index++)
      if (index === 0 || this.#cells[index] !== this.#cells[index - 1]) count++;
    const parts = new Array<Intl.RelativeTimeFormatPart>(count);
    let start = 0;
    let output = 0;
    while (start < text.length) {
      const cell = this.#cells[start]!;
      let end = start + 1;
      while (end < text.length && this.#cells[end] === cell) end++;
      const value = text.slice(start, end);
      const field = cell & 127;
      parts[output++] =
        field === 0 ? { type: "literal", value } : { type: numberType(field - 1), value, unit };
      start = end;
    }
    return parts;
  }
}
