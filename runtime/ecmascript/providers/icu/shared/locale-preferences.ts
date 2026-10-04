import {
  calendarRegions,
  weekRegions,
  hourRegions,
  hourRegionCodes,
  hourLocales,
  hourLocaleCodes,
  hourPatterns,
} from "./locale-preference-data.ts";

// Fixed-width sorted ASCII keys; lookup allocates no intermediate key strings.
function regionIndex(keys: string, region: string): number {
  if (region.length !== 2 && region.length !== 3) return -1;
  const value =
    region.charCodeAt(0) * 16384 +
    region.charCodeAt(1) * 128 +
    (region.length === 2 ? 95 : region.charCodeAt(2));
  let low = 0,
    high = keys.length / 3;
  while (low < high) {
    const middle = Math.trunc((low + high) / 2),
      at = middle * 3;
    const candidate =
      keys.charCodeAt(at) * 16384 + keys.charCodeAt(at + 1) * 128 + keys.charCodeAt(at + 2);
    if (candidate === value) return middle;
    if (candidate < value) low = middle + 1;
    else high = middle;
  }
  return -1;
}

// These queries deliberately report only explicit supplemental entries. The
// shared service chooses override/base/world fallback, rather than ICU silently
// replacing an absent override with world data before that choice is possible.
export function hasCalendarPreferences(locale: string): boolean {
  return regionIndex(calendarRegions, locale.slice(locale.lastIndexOf("-") + 1)) >= 0;
}
export function hasWeekPreferences(region: string): boolean {
  return regionIndex(weekRegions, region) >= 0;
}
export function hourCycleValues(locale: string): readonly string[] {
  let low = 0;
  let high: number = hourLocales.length;
  let code = -1;
  while (low < high) {
    const middle = Math.trunc((low + high) / 2),
      key = hourLocales[middle]!;
    if (key === locale) {
      code = hourLocaleCodes.charCodeAt(middle) - 97;
      break;
    }
    if (key < locale) low = middle + 1;
    else high = middle;
  }
  if (code < 0) {
    const index = regionIndex(hourRegions, locale.slice(locale.lastIndexOf("-") + 1));
    if (index < 0) return [];
    code = hourRegionCodes.charCodeAt(index) - 97;
  }
  return hourPatterns[code]!;
}
