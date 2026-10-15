// An exported string result that may be absent: `string | null` crosses as
// node's `null`, `string | undefined` as `undefined`. The two share one
// representation, a null reference, and the export's declaration says which
// absence it is (`Func::result_absent`). The control is a plain `string`.

export function stringOrNull(present: boolean): string | null {
  return present ? "text" : null;
}

export function stringOrUndefined(present: boolean): string | undefined {
  return present ? "text" : undefined;
}

export function joinedOrNull(present: boolean, times: number): string | null {
  if (!present) return null;
  let text = "";
  for (let i = 0; i < times && i < 4; i++) text += "ab";
  return text;
}

export function plainString(present: boolean): string {
  return present ? "text" : "";
}
