import { stringOption } from "./options.ts";

const notations: readonly Intl.ResolvedNumberFormatOptions["notation"][] = [
  "standard",
  "scientific",
  "engineering",
  "compact",
];
const compactDisplays: readonly NonNullable<Intl.ResolvedNumberFormatOptions["compactDisplay"]>[] =
  ["short", "long"];

export function numberNotation(
  value: Intl.NumberFormatOptions["notation"],
): Intl.ResolvedNumberFormatOptions["notation"] {
  return stringOption(value, notations, "standard");
}

export function compactDisplay(
  value: Intl.NumberFormatOptions["compactDisplay"],
): NonNullable<Intl.ResolvedNumberFormatOptions["compactDisplay"]> {
  return stringOption(value, compactDisplays, "short");
}

export function notationSkeleton(
  notation: Intl.ResolvedNumberFormatOptions["notation"],
  compact: Intl.ResolvedNumberFormatOptions["compactDisplay"],
): string {
  if (notation === "compact") return "compact-" + compact + " ";
  return notation === "standard" ? "" : notation + " ";
}
