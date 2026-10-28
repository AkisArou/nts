// Source control for builtin-study-es-intl-datetime. The return observes its
// operation; it is not a claim that the ambient builtin is provided.
class SourceDateTimeFormat { constructor(_locale: string, private options: { timeZone: string }) {} format(date: Date): string { return this.options.timeZone + ":" + date.getTime(); } }

export function esIntlDatetimeControl(): string {
  return new SourceDateTimeFormat("en-US", { timeZone: "UTC" }).format(new Date(0));
}
