import { LocaleIdentifier, validRegion, validScript, validUnicodeType } from "./locale-id.ts";
import { validCurrency } from "./currency.ts";

// Specification names, in the order of the provider's field ordinal. The
// library of() input is string; this runtime table is not a copied public type.
const fields: readonly string[] = [
  "era",
  "year",
  "quarter",
  "month",
  "weekOfYear",
  "weekday",
  "day",
  "dayPeriod",
  "hour",
  "minute",
  "second",
  "timeZoneName",
];

export function displayNameField(code: string): number {
  const field = fields.indexOf(code);
  if (field < 0) throw new RangeError("Invalid DisplayNames date-time field");
  return field;
}

export function displayNameCode(type: Intl.DisplayNamesType, code: string): string {
  if (type === "language") {
    const identifier = new LocaleIdentifier(code);
    if (identifier.baseName.toLowerCase() !== code.toLowerCase())
      throw new RangeError("DisplayNames language codes cannot contain extensions");
    return identifier.baseName;
  }
  if (type === "region") {
    if (!validRegion(code)) throw new RangeError("Invalid DisplayNames region code");
    return code.toUpperCase();
  }
  if (type === "script") {
    if (!validScript(code)) throw new RangeError("Invalid DisplayNames script code");
    return code.charAt(0).toUpperCase() + code.slice(1).toLowerCase();
  }
  if (type === "currency") {
    if (!validCurrency(code)) throw new RangeError("Invalid DisplayNames currency code");
    return code.toUpperCase();
  }
  if (type === "calendar") {
    if (!validUnicodeType(code)) throw new RangeError("Invalid DisplayNames calendar code");
    return code.toLowerCase();
  }
  displayNameField(code);
  return code;
}
