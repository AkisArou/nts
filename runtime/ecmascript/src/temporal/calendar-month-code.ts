const NUMBERED_CODES = [
  "M01",
  "M02",
  "M03",
  "M04",
  "M05",
  "M06",
  "M07",
  "M08",
  "M09",
  "M10",
  "M11",
  "M12",
  "M13",
];
const LEAP_CODES = [
  "M01L",
  "M02L",
  "M03L",
  "M04L",
  "M05L",
  "M06L",
  "M07L",
  "M08L",
  "M09L",
  "M10L",
  "M11L",
  "M12L",
];

// Calendar data has already validated this scalar. Common month codes reuse
// immutable strings rather than formatting a number on every getter call.
export function formatMonthCode(code: number): string {
  return code > 100 ? LEAP_CODES[code - 101]! : NUMBERED_CODES[code - 1]!;
}

// Prepared strings only. Public field conversion occurs before this scalar
// parser; provider data validation uses the same syntax without JS coercion.
export function decodeMonthCode(code: string): number {
  const first = code.charCodeAt(1);
  const second = code.charCodeAt(2);
  const leap = code.length === 4;
  if (
    (code.length !== 3 && !leap) ||
    (leap && code.charCodeAt(3) !== 76) ||
    code.charCodeAt(0) !== 77 ||
    first < 48 ||
    first > 57 ||
    second < 48 ||
    second > 57
  )
    return NaN;
  return (first - 48) * 10 + second - 48 + (leap ? 100 : 0);
}

export function validCalendarMonthCode(calendar: string, code: number): boolean {
  if (code >= 1 && code <= 12) return true;
  if (code === 13)
    return calendar === "coptic" || calendar === "ethiopic" || calendar === "ethioaa";
  if (calendar === "hebrew") return code === 105;
  return (calendar === "chinese" || calendar === "dangi") && code >= 101 && code <= 112;
}
