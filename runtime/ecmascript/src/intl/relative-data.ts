// ICU text and number-field primitives. Providers reuse formatting scratch;
// shared TypeScript owns standard option/input handling and the returned parts.
export interface RelativeTimePrimitive {
  // Fields 0/1/2/6 are number fields; 14 brackets the complete inserted number
  // so adjacent literals inside/outside its pattern remain distinct JS parts.
  format(value: number, unit: number, auto: boolean, fields: boolean): string;
  fieldCount(): number;
  field(index: number): number;
  start(index: number): number;
  end(index: number): number;
}
