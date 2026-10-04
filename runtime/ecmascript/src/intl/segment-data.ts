// ICU boundary data. Each text cursor owns its position and immutable input;
// opening another text shares only the configured segmentation rules.
export interface SegmenterPrimitive<P extends SegmenterPrimitive<P>> {
  forText(input: string): P;
  next(): number;
  previous(): number;
  following(index: number): number;
  ruleStatus(): number;
}
