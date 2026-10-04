// Unfiltered ICU data: calendar, collation, currency and numbering-system
// names, respectively. Shared semantics canonicalize, filter and order them.
export interface SupportedValueData {
  availableValues(category: number): string[];
  hasCurrencyName(code: string): boolean;
}
