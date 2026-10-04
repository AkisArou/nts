// Public LDML pattern syntax supplies related-year/cyclic-name semantics.
// ICU does not expose stable related-year field identifiers. A provider locates
// a field's start using a public marker in the otherwise unchanged pattern,
// then measure the isolated field. No localized-output search is involved.
export class DateFieldPatterns {
  readonly #pattern: string;
  readonly #marker: string;
  #index = 0;
  #quoted = false;
  #start = 0;
  #end = 0;
  readonly yearNameOnly: boolean;
  readonly monthNames: boolean;
  field = 0;

  constructor(pattern: string) {
    this.#pattern = pattern;
    let quoted = false;
    let occupied = 0;
    let relatedYear = false;
    let cyclicYear = false;
    let numericYear = false;
    let monthNames = false;
    for (let index = 0; index < pattern.length; index++) {
      const symbol = pattern.charAt(index);
      if (symbol === "'") {
        if (pattern.charAt(index + 1) === "'") index++;
        else quoted = !quoted;
      } else if (!quoted) {
        if (symbol === "A") occupied |= 1;
        else if (symbol === "g") occupied |= 2;
        else if (symbol === "r" || symbol === "U") {
          if (symbol === "r") relatedYear = true;
          if (symbol === "U") cyclicYear = true;
        } else if (symbol === "y") numericYear = true;
        else if (
          (symbol === "M" || symbol === "L") &&
          pattern.charAt(index + 1) === symbol &&
          pattern.charAt(index + 2) === symbol
        )
          monthNames = true;
      }
    }
    if ((relatedYear || (cyclicYear && numericYear)) && occupied === 3)
      throw new RangeError("Calendar field spans require an unused public marker");
    // These markers do not alter contextual month/day-period formatting.
    // ECMA-402-selected patterns use neither; g also supports raw A patterns.
    this.#marker = occupied & 1 ? "g" : "A";
    this.yearNameOnly = cyclicYear && !numericYear;
    this.monthNames = monthNames;
  }
  next(): boolean {
    const pattern = this.#pattern;
    while (this.#index < pattern.length) {
      const start = this.#index;
      const symbol = pattern.charAt(this.#index++);
      if (symbol === "'") {
        if (pattern.charAt(this.#index) === "'") this.#index++;
        else this.#quoted = !this.#quoted;
      } else if (!this.#quoted && (symbol === "r" || symbol === "U")) {
        while (pattern.charAt(this.#index) === symbol) this.#index++;
        this.#start = start;
        this.#end = this.#index;
        this.field = symbol === "r" ? 11 : 12;
        return true;
      }
    }
    return false;
  }
  markerCode(): number {
    return this.#marker === "A" ? 0 : 1;
  }
  markerPattern(): string {
    return this.#start === 0
      ? ""
      : this.#pattern.slice(0, this.#start) + this.#marker + this.#pattern.slice(this.#end);
  }
  fieldPattern(): string {
    return this.#pattern.slice(this.#start, this.#end);
  }
}

// Public ICU calendar names and month-symbol slots are data adapter details.
// Arithmetic, ordinal months and canonical month codes come from shared TS.
export function presentationCalendar(type: string): string {
  return type === "gregorian" ? "gregory" : type === "ethiopic-amete-alem" ? "ethioaa" : type;
}
export function presentationMonth(
  calendar: string,
  ordinal: number,
  code: number,
  names: boolean,
): number {
  if (calendar === "chinese" || calendar === "dangi") return (code % 100) - 1;
  if (calendar !== "hebrew") return code - 1;
  if (!names) return ordinal;
  if (code === 105) return 5; // Adar I.
  if (code === 6 && ordinal === 6) return 13; // Adar II.
  return code < 6 ? code - 1 : code;
}
