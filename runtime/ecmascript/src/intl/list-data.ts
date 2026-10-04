// Public ICU data queries resolve the pinned locale templates once at creation.
export interface ListPatternData {
  listSamples(locale: string, type: number, style: number, tokens: string[]): readonly string[];
  isHebrew(codePoint: number): boolean;
}
