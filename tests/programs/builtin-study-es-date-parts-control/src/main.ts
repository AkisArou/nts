// Source control for builtin-study-es-date-parts. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
class SourceDate {
  constructor(private year: number, private month: number = 0, private day: number = 1) {}
  toISOString(): string { return "1970-01-01T00:00:00.000Z"; }
  toString(): string { return "source date " + this.year; }
  getFullYear(): number { return this.year; }
  getMonth(): number { return this.month; }
  getDay(): number { return this.day - 2; }
}

export function esDatePartsControl(): string {
  const d = new SourceDate(2020, 1, 3); return d.getFullYear() + ":" + d.getMonth() + ":" + d.getDay();
}
