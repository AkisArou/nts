// ICU/CLDR pattern metadata, parsed once during formatter construction. This
// reads pattern syntax; it never infers fields by scraping localized output.
export function datePatternField(symbol: string): number {
  if (symbol === "G") return 0;
  if (symbol === "y" || symbol === "u") return 1;
  if (symbol === "M" || symbol === "L") return 2;
  if (symbol === "d") return 3;
  if (symbol === "h" || symbol === "H" || symbol === "k" || symbol === "K") return 4;
  if (symbol === "m") return 5;
  if (symbol === "s") return 6;
  if (symbol === "S") return 7;
  if (symbol === "E" || symbol === "e" || symbol === "c") return 8;
  if (symbol === "a" || symbol === "b" || symbol === "B") return 9;
  if (symbol === "z" || symbol === "v" || symbol === "O" || symbol === "Z") return 10;
  if (symbol === "r") return 11;
  if (symbol === "U") return 12;
  return -1;
}
function wordWidth(count: number): NonNullable<Intl.DateTimeFormatOptions["weekday"]> {
  return count === 4 ? "long" : count === 5 ? "narrow" : "short";
}
function numericWidth(count: number): NonNullable<Intl.DateTimeFormatOptions["year"]> {
  return count === 2 ? "2-digit" : "numeric";
}
function hourSymbol(cycle: Intl.LocaleHourCycleKey): string {
  if (cycle === "h11") return "K";
  if (cycle === "h12") return "h";
  if (cycle === "h23") return "H";
  return "k";
}

export class DateTimePattern {
  readonly pattern: string;
  readonly components: Readonly<Intl.DateTimeFormatOptions>;
  readonly hourCycle: Intl.LocaleHourCycleKey | undefined;
  readonly supported: boolean;
  readonly fieldMask: number;
  readonly dayPeriodPattern: string | undefined;

  constructor(pattern: string) {
    let weekday: Intl.DateTimeFormatOptions["weekday"];
    let era: Intl.DateTimeFormatOptions["era"];
    let year: Intl.DateTimeFormatOptions["year"];
    let month: Intl.DateTimeFormatOptions["month"];
    let day: Intl.DateTimeFormatOptions["day"];
    let dayPeriod: Intl.DateTimeFormatOptions["dayPeriod"];
    let hour: Intl.DateTimeFormatOptions["hour"];
    let minute: Intl.DateTimeFormatOptions["minute"];
    let second: Intl.DateTimeFormatOptions["second"];
    let fractionalSecondDigits: Intl.DateTimeFormatOptions["fractionalSecondDigits"];
    let timeZoneName: Intl.DateTimeFormatOptions["timeZoneName"];
    let cycle: Intl.LocaleHourCycleKey | undefined;
    let quoted = false;
    let supported = true;
    let fieldMask = 0;
    let dayPeriodPattern: string | undefined;
    let index = 0;
    while (index < pattern.length) {
      const symbol = pattern.charAt(index++);
      if (symbol === "'") {
        if (pattern.charAt(index) === "'") index++;
        else quoted = !quoted;
        continue;
      }
      if (quoted) continue;
      const code = symbol.charCodeAt(0);
      if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122))) continue;
      const start = index - 1;
      while (pattern.charAt(index) === symbol) index++;
      const count = index - start;
      const field = datePatternField(symbol);
      if (field >= 0) fieldMask |= 1 << field;
      if (symbol === "G") era = wordWidth(count);
      else if (symbol === "y") year = numericWidth(count);
      else if (symbol === "U" || symbol === "r" || symbol === "u") year = "numeric";
      else if (symbol === "M" || symbol === "L")
        month =
          count <= 2
            ? numericWidth(count)
            : count === 3
              ? "short"
              : count === 4
                ? "long"
                : "narrow";
      else if (symbol === "d") day = numericWidth(count);
      else if (symbol === "E" || ((symbol === "e" || symbol === "c") && count >= 3))
        weekday = wordWidth(count);
      else if (symbol === "h" || symbol === "H" || symbol === "k" || symbol === "K") {
        hour = numericWidth(count);
        cycle = symbol === "K" ? "h11" : symbol === "h" ? "h12" : symbol === "H" ? "h23" : "h24";
      } else if (symbol === "m") minute = numericWidth(count);
      else if (symbol === "s") second = numericWidth(count);
      else if (symbol === "S") {
        if (count === 1 || count === 2 || count === 3) fractionalSecondDigits = count;
        else supported = false;
      } else if (symbol === "B" || symbol === "b") {
        dayPeriod = wordWidth(count);
        dayPeriodPattern = symbol.repeat(count);
      } else if (symbol === "z") timeZoneName = count < 4 ? "short" : "long";
      else if (symbol === "v") timeZoneName = count < 4 ? "shortGeneric" : "longGeneric";
      else if (symbol === "O") timeZoneName = count < 4 ? "shortOffset" : "longOffset";
      else if (symbol === "Z") timeZoneName = count < 4 ? "shortOffset" : "longOffset";
      // AM/PM is an implicit companion to a 12-hour field. The public
      // dayPeriod option denotes flexible day periods, represented by B/b.
      else if (symbol !== "a") supported = false;
    }
    if (quoted) throw new Error("ICU returned an unterminated date pattern literal");
    this.components = {
      weekday,
      era,
      year,
      month,
      day,
      dayPeriod,
      hour,
      minute,
      second,
      fractionalSecondDigits,
      timeZoneName,
    };
    this.hourCycle = cycle;
    this.supported = supported;
    this.fieldMask = fieldMask;
    this.dayPeriodPattern = dayPeriodPattern;
    this.pattern = pattern;
  }

  withHourCycle(cycle: Intl.LocaleHourCycleKey): string {
    const replacement = hourSymbol(cycle);
    let result = "";
    let from = 0;
    let quoted = false;
    for (let index = 0; index < this.pattern.length; index++) {
      const symbol = this.pattern.charAt(index);
      if (symbol === "'") {
        if (this.pattern.charAt(index + 1) === "'") index++;
        else quoted = !quoted;
      } else if (
        !quoted &&
        (symbol === "h" || symbol === "H" || symbol === "k" || symbol === "K") &&
        symbol !== replacement
      ) {
        result += this.pattern.slice(from, index) + replacement;
        from = index + 1;
      }
    }
    return from === 0 ? this.pattern : result + this.pattern.slice(from);
  }
  withRelatedYear(): string {
    let result = "";
    let from = 0;
    let quoted = false;
    for (let index = 0; index < this.pattern.length; index++) {
      const symbol = this.pattern.charAt(index);
      if (symbol === "'") {
        if (this.pattern.charAt(index + 1) === "'") index++;
        else quoted = !quoted;
      } else if (!quoted && (symbol === "y" || symbol === "u" || symbol === "U")) {
        const start = index;
        while (this.pattern.charAt(index + 1) === symbol) index++;
        result += this.pattern.slice(from, start) + "r";
        from = index + 1;
      }
    }
    return from === 0 ? this.pattern : result + this.pattern.slice(from);
  }
}

function wordSkeleton(symbol: string, width: string | undefined): string {
  return width === undefined
    ? ""
    : symbol.repeat(width === "long" ? 4 : width === "narrow" ? 5 : symbol === "E" ? 3 : 1);
}
function numericSkeleton(symbol: string, width: string | undefined): string {
  return width === undefined ? "" : width === "2-digit" ? symbol + symbol : symbol;
}

export function dateTimeSkeleton(
  components: Readonly<Intl.DateTimeFormatOptions>,
  cycle: Intl.LocaleHourCycleKey,
): string {
  const month = components.month;
  const zone = components.timeZoneName;
  const fraction = components.fractionalSecondDigits;
  return (
    wordSkeleton("G", components.era) +
    numericSkeleton("y", components.year) +
    (month === undefined
      ? ""
      : month === "short"
        ? "MMM"
        : month === "long"
          ? "MMMM"
          : month === "narrow"
            ? "MMMMM"
            : numericSkeleton("M", month)) +
    numericSkeleton("d", components.day) +
    wordSkeleton("E", components.weekday) +
    wordSkeleton("B", components.dayPeriod) +
    numericSkeleton(hourSymbol(cycle), components.hour) +
    numericSkeleton("m", components.minute) +
    numericSkeleton("s", components.second) +
    (fraction === undefined ? "" : "S".repeat(fraction)) +
    (zone === undefined
      ? ""
      : zone === "short"
        ? "z"
        : zone === "long"
          ? "zzzz"
          : zone === "shortOffset"
            ? "O"
            : zone === "longOffset"
              ? "OOOO"
              : zone === "shortGeneric"
                ? "v"
                : "vvvv")
  );
}

// ECMA-402 BasicFormatMatcher. Inputs are normalized records, so comparing
// candidate metadata cannot repeat reads of the user's options object.
function rank(width: string): number {
  if (width === "2-digit") return 0;
  if (width === "numeric") return 1;
  if (width === "narrow") return 2;
  if (width === "short") return 3;
  return 4;
}
function deltaScore(delta: number): number {
  return delta <= -2 ? -8 : delta === -1 ? -6 : delta === 1 ? -3 : delta >= 2 ? -6 : 0;
}
function widthScore(wanted: string | undefined, actual: string | undefined): number {
  if (wanted === actual) return 0;
  if (wanted === undefined) return -20;
  if (actual === undefined) return -120;
  return deltaScore(rank(actual) - rank(wanted));
}
function fractionScore(wanted: number | undefined, actual: number | undefined): number {
  if (wanted === actual) return 0;
  if (wanted === undefined) return -20;
  if (actual === undefined) return -120;
  return deltaScore(actual - wanted);
}
function zoneScore(
  wanted: Intl.DateTimeFormatOptions["timeZoneName"],
  actual: Intl.DateTimeFormatOptions["timeZoneName"],
): number {
  if (wanted === actual) return 0;
  if (wanted === undefined) return -20;
  if (actual === undefined) return -120;
  if (wanted === "short" || wanted === "shortGeneric") {
    if (actual === "shortOffset") return -1;
    if (actual === "longOffset") return -4;
    if (
      (wanted === "short" && actual === "long") ||
      (wanted === "shortGeneric" && actual === "longGeneric")
    )
      return -3;
  } else if (wanted === "long" || wanted === "longGeneric") {
    if (actual === "longOffset") return -1;
    if (actual === "shortOffset") return -9;
    if (
      (wanted === "long" && actual === "short") ||
      (wanted === "longGeneric" && actual === "shortGeneric")
    )
      return -8;
  } else if (wanted === "shortOffset" && actual === "longOffset") return -3;
  else if (wanted === "longOffset" && actual === "shortOffset") return -8;
  return -120;
}

export function basicDateTimePattern(
  options: Readonly<Intl.DateTimeFormatOptions>,
  candidates: readonly DateTimePattern[],
): DateTimePattern {
  let best: DateTimePattern | undefined;
  let bestScore = -Infinity;
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]!;
    if (!candidate.supported) continue;
    const format = candidate.components;
    const score =
      widthScore(options.weekday, format.weekday) +
      widthScore(options.era, format.era) +
      widthScore(options.year, format.year) +
      widthScore(options.month, format.month) +
      widthScore(options.day, format.day) +
      widthScore(options.dayPeriod, format.dayPeriod) +
      widthScore(options.hour, format.hour) +
      widthScore(options.minute, format.minute) +
      widthScore(options.second, format.second) +
      fractionScore(options.fractionalSecondDigits, format.fractionalSecondDigits) +
      zoneScore(options.timeZoneName, format.timeZoneName);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  if (best === undefined) throw new Error("ICU supplied no supported date patterns");
  return best;
}
