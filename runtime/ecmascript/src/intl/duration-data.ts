// Public ICU numeric measure samples and their localized digit tokens.
// Shared TS decodes separators and padding; no private CLDR resource access.
export interface DurationPatternData {
  durationSamples(locale: string): readonly string[];
}
