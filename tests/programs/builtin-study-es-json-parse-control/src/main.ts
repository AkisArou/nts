// The literal is the result of parsing the study's input; typeof is still observed.
export function jsonParseControl(): string {
  const value: unknown = [1, 2];
  return typeof value;
}
