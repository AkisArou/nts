// Pinned plural rules applied to already validated ICU number skeletons.
// Category codes follow zero, one, two, few, many, other; keywords are a mask.
export interface PluralRulesPrimitive {
  select(value: number, negative: boolean): number;
  selectDecimal(value: string, negative: boolean): number;
  selectRange(start: string, end: string, negativeStart: boolean, negativeEnd: boolean): number;
  categories(): number;
}
