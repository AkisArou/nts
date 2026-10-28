// Source control for builtin-study-es-intl-number. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
class SourceNumberFormat { constructor(private locale: string) {} format(value: number): string { return this.locale + ":" + value; } }

export function esIntlNumberControl(): string {
  return new SourceNumberFormat("en-US").format(1234.5);
}
