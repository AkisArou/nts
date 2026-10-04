// The specified era rules use only calendar arithmetic years and ISO days;
// they do not depend on provider era numbering or historical Julian cutovers.
export function calendarEra(calendar: string, year: number, epochDay: number): string | undefined {
  switch (calendar) {
    case "buddhist":
      return "be";
    case "coptic":
    case "hebrew":
      return "am";
    case "ethioaa":
      return "aa";
    case "ethiopic":
      return year > 0 ? "am" : "aa";
    case "gregory":
      return year > 0 ? "ce" : "bce";
    case "indian":
      return "shaka";
    case "islamic-civil":
    case "islamic-tbla":
    case "islamic-umalqura":
      return year > 0 ? "ah" : "bh";
    case "persian":
      return "ap";
    case "roc":
      return year > 0 ? "roc" : "broc";
    case "japanese":
      // ISO days of the government era boundaries, with the specified Gregorian
      // era system through 1872-12-31 (the proleptic civil-calendar boundary).
      if (epochDay >= 18017) return "reiwa";
      if (epochDay >= 6947) return "heisei";
      if (epochDay >= -15713) return "showa";
      if (epochDay >= -20974) return "taisho";
      if (year >= 1873) return "meiji";
      return year > 0 ? "ce" : "bce";
    default:
      return undefined;
  }
}

export function calendarEraYear(calendar: string, era: string, year: number): number {
  switch (era) {
    case "bce":
    case "bh":
    case "broc":
      return 1 - year;
    case "aa":
      return calendar === "ethioaa" ? year : year + 5500;
    case "reiwa":
      return year - 2018;
    case "heisei":
      return year - 1988;
    case "showa":
      return year - 1925;
    case "taisho":
      return year - 1911;
    case "meiji":
      return year - 1867;
    default:
      return year;
  }
}

export function calendarSupportsEra(calendar: string): boolean {
  return calendar !== "iso8601" && calendar !== "chinese" && calendar !== "dangi";
}

// Field bags permit lenient era-year interpretation, including values beyond
// a regnal era's boundaries. The resulting date determines its actual era.
export function calendarYearForEra(calendar: string, era: string, year: number): number {
  switch (calendar) {
    case "gregory":
    case "japanese":
      if (era === "ce" || era === "ad") return year;
      if (era === "bce" || era === "bc") return 1 - year;
      if (calendar === "japanese") {
        if (era === "reiwa") return year + 2018;
        if (era === "heisei") return year + 1988;
        if (era === "showa") return year + 1925;
        if (era === "taisho") return year + 1911;
        if (era === "meiji") return year + 1867;
      }
      break;
    case "ethiopic":
      if (era === "aa") return year - 5500;
      if (era === "am") return year;
      break;
    case "ethioaa":
      if (era === "aa") return year;
      break;
    case "coptic":
    case "hebrew":
      if (era === "am") return year;
      break;
    case "buddhist":
      if (era === "be") return year;
      break;
    case "indian":
      if (era === "shaka") return year;
      break;
    case "persian":
      if (era === "ap") return year;
      break;
    case "islamic-civil":
    case "islamic-tbla":
    case "islamic-umalqura":
      if (era === "ah") return year;
      if (era === "bh") return 1 - year;
      break;
    case "roc":
      if (era === "roc") return year;
      if (era === "broc") return 1 - year;
      break;
  }
  throw new RangeError("Era is invalid for calendar");
}
