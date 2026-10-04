// Reduced ABI witness: a standard duration part can omit `unit` on a literal.
// Every record is valid without casts or invented result types.
export function durationPartRecord(): string {
  const parts: Intl.DurationFormatPart[] = [
    { type: "integer", value: "1", unit: "hour" },
    { type: "literal", value: ":" },
    { type: "literal", value: " ", unit: "second" },
  ];
  let text = "";
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    text += part.type + "=" + part.value + ";";
  }
  return text;
}
