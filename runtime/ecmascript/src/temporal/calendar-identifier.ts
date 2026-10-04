// Canonical built-in identities, independent of parsing, host locale data and
// provider aliases. The closed set also bounds the environment's cache.
export function canonicalCalendarIdentifier(identifier: string): string {
  if (typeof identifier !== "string") throw new TypeError("Calendar must be a string");
  const id = identifier.toLowerCase();
  if (id === "islamicc") return "islamic-civil";
  if (id === "ethiopic-amete-alem") return "ethioaa";
  calendarIndex(id);
  return id;
}

export function calendarIndex(identifier: string): number {
  switch (identifier) {
    case "iso8601":
      return 0;
    case "buddhist":
      return 1;
    case "chinese":
      return 2;
    case "coptic":
      return 3;
    case "dangi":
      return 4;
    case "ethioaa":
      return 5;
    case "ethiopic":
      return 6;
    case "gregory":
      return 7;
    case "hebrew":
      return 8;
    case "indian":
      return 9;
    case "islamic-civil":
      return 10;
    case "islamic-tbla":
      return 11;
    case "islamic-umalqura":
      return 12;
    case "japanese":
      return 13;
    case "persian":
      return 14;
    case "roc":
      return 15;
    default:
      throw new RangeError("Unknown built-in calendar");
  }
}
