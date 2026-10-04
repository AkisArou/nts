import type {
  DateTimeFormatterPrimitive,
  DateTimePatternData,
} from "../../../../../runtime/ecmascript/src/intl/date-time-data.ts";
import { DateTimeTemplate } from "../../../../../runtime/ecmascript/src/intl/date-time-template.ts";

// Supplementary ABI/lifetime witness. Original Test262 owns date semantics;
// this checks that both compiled adapters preserve supplied fields and spans.
export function preparedDateFields<
  P extends DateTimeFormatterPrimitive,
  G extends DateTimePatternData,
>(open: (locale: string, pattern: string, zone: string) => P, patterns: G): string {
  const instant = 1898726400000;
  const formatter = open("en-u-ca-chinese", "r|M|d|EEEE|HH:mm:ss.SSS", "UTC");
  formatter.setCalendarFields(2030, 47, 0, 1, 2, 29, 58);
  const first = formatter.format(instant, true);
  let mask = 0;
  for (let index = 0; index < formatter.fieldCount(); index++) {
    if (formatter.start(index) < 0 || formatter.end(index) > first.length)
      throw new Error("Prepared date field span outside text");
    mask |= 1 << formatter.field(index);
  }
  let result =
    formatter.offsetMilliseconds(instant) + ":" + first + ":" + formatter.fieldCount() + ":" + mask;
  for (let index = 0; index < 2000; index++) {
    const day = 29 + (index % 2);
    formatter.setCalendarFields(2030, 47, 0, 1, 2, day, 58 + (index % 2));
    const text = formatter.format(instant, false);
    const expected = "2030|2|" + day + "|Sunday|00:00:00.000";
    if (text !== expected) throw new Error("Prepared fields remained cached at the same instant");
  }
  result += "\nsame-instant:2000";
  const wide = open("en-u-ca-chinese-nu-mathbold", "r|M|d", "UTC");
  wide.setCalendarFields(2030, 47, 0, 0, 1, 29, 58);
  const wideText = wide.format(instant, true);
  result += "\nutf16:" + wideText + ":" + wideText.length;
  for (let index = 0; index < wide.fieldCount(); index++)
    result += ";" + wide.field(index) + "=" + wide.start(index) + ":" + wide.end(index);
  const cyclic = open("en-u-ca-chinese", "r U", "UTC");
  cyclic.setCalendarFields(2030, 47, 0, 0, 1, 29, 58);
  if (
    cyclic.format(instant, true) !== "2030 geng-xu" ||
    cyclic.fieldCount() !== 2 ||
    cyclic.field(0) !== 11 ||
    cyclic.start(0) !== 0 ||
    cyclic.end(0) !== 4 ||
    cyclic.field(1) !== 12 ||
    cyclic.start(1) !== 5 ||
    cyclic.end(1) !== 12
  )
    throw new Error("Public cyclic-only year spans were not preserved");
  // A locator must measure supplied fields, including their actual digit width,
  // rather than recalculate the calendar year from the timestamp.
  cyclic.setCalendarFields(12000, 47, 0, 0, 1, 29, 58);
  if (
    cyclic.format(instant, true) !== "12000 geng-xu" ||
    cyclic.fieldCount() !== 2 ||
    cyclic.end(0) !== 5 ||
    cyclic.start(1) !== 6 ||
    cyclic.end(1) !== 13
  )
    throw new Error("Related-year locator recalculated supplied fields");
  const late = open("en-u-ca-chinese", "r U", "UTC");
  late.format(instant, true);
  late.setCalendarFields(12000, 47, 0, 0, 1, 29, 58);
  if (late.format(instant, true) !== "12000 geng-xu" || late.end(0) !== 5)
    throw new Error("Related-year locator retained its original chronology");
  // Escaped literals are not fields. A cyclic name and a separate numeric
  // year must retain distinct spans even though ICU4J calls both YEAR.
  const mixed = open("en-u-ca-chinese", "'U''r 'M d r '年' U HH:mm yyyy", "UTC");
  mixed.setCalendarFields(2030, 47, 0, 0, 1, 29, 58);
  result += "\nmixed:" + mixed.format(instant, true);
  for (let index = 0; index < mixed.fieldCount(); index++)
    result += ";" + mixed.field(index) + "=" + mixed.start(index) + ":" + mixed.end(index);
  const offset = open("en", "HH:mm", "America/New_York");
  result += "\noffset:" + offset.offsetMilliseconds(1710055800000);
  const interval = patterns.intervalPattern("yMMMd", 3);
  if (!(interval.startsWith("earliestFirst:") || interval.startsWith("latestFirst:")))
    throw new Error("Interval pattern has no endpoint order");
  if (!interval.includes("M") || !interval.includes("d"))
    throw new Error("Interval pattern lost selected fields");
  if (patterns.intervalPattern("yMMMd", 6) !== "")
    throw new Error("Date-only interval data unexpectedly includes minutes");
  const fallback = patterns.intervalFallback();
  const connector = patterns.dateTimeConnector(3);
  if (
    !(
      fallback.includes("{0}") &&
      fallback.includes("{1}") &&
      connector.includes("{0}") &&
      connector.includes("{1}")
    )
  )
    throw new Error("Interval fallback or date/time connector lost an argument");
  const join = new DateTimeTemplate(patterns.dateTimeConnector(0), "ldml");
  if (join.firstArgument !== 1 || join.separator !== " at ")
    throw new Error("Date/time connector did not decode LDML quoting");
  const quoted = new DateTimeTemplate("'{0}' {0} – '{1}' {1}");
  if (quoted.firstArgument !== 0 || quoted.prefix !== "{0} " || quoted.separator !== " – {1} ")
    throw new Error("Interval fallback did not preserve quoted braces");
  const literal = new DateTimeTemplate("{1} ''o'' 'clock' {0}", "ldml");
  if (literal.firstArgument !== 1 || literal.separator !== " 'o' clock ")
    throw new Error("Date/time connector did not preserve doubled apostrophes");
  const named = "y GGGG MMMM d";
  const cases = [
    {
      calendar: "islamic-civil",
      pattern: named,
      related: 600,
      year: 23,
      era: 1,
      month: 2,
      code: 3,
      expected: "23 Before Hijrah Rabiʻ I 1",
    },
    {
      calendar: "coptic",
      pattern: named,
      related: 250,
      year: -34,
      era: 0,
      month: 0,
      code: 1,
      expected: "-34 Anno Martyrum Tout 1",
    },
    {
      calendar: "hebrew",
      pattern: named,
      related: 2025,
      year: 5785,
      era: 0,
      month: 5,
      code: 6,
      expected: "5785 AM Adar 1",
    },
    {
      calendar: "hebrew",
      pattern: "y GGGG M d",
      related: 2025,
      year: 5785,
      era: 0,
      month: 5,
      code: 6,
      expected: "5785 AM 6 1",
    },
    {
      calendar: "hebrew",
      pattern: named,
      related: 2024,
      year: 5784,
      era: 0,
      month: 6,
      code: 6,
      expected: "5784 AM Adar II 1",
    },
    {
      calendar: "hebrew",
      pattern: "y GGGG M d",
      related: 2024,
      year: 5784,
      era: 0,
      month: 6,
      code: 6,
      expected: "5784 AM 7 1",
    },
    {
      calendar: "hebrew",
      pattern: named,
      related: 2024,
      year: 5784,
      era: 0,
      month: 5,
      code: 105,
      expected: "5784 AM Adar I 1",
    },
    {
      calendar: "japanese",
      pattern: named,
      related: -100,
      year: 101,
      era: 0,
      month: 5,
      code: 6,
      expected: "101 Before Christ June 1",
    },
    {
      calendar: "japanese",
      pattern: named,
      related: 1850,
      year: 1850,
      era: 1,
      month: 5,
      code: 6,
      expected: "1850 Anno Domini June 1",
    },
    {
      calendar: "japanese",
      pattern: named,
      related: 1880,
      year: 13,
      era: 2,
      month: 5,
      code: 6,
      expected: "13 Meiji June 1",
    },
    {
      calendar: "japanese",
      pattern: named,
      related: 2025,
      year: 7,
      era: 6,
      month: 5,
      code: 6,
      expected: "7 Reiwa June 1",
    },
    {
      calendar: "buddhist",
      pattern: named,
      related: 2025,
      year: 2568,
      era: 0,
      month: 5,
      code: 6,
      expected: "2568 BE June 1",
    },
  ];
  for (const sample of cases) {
    const value = open("en-u-ca-" + sample.calendar, sample.pattern, "UTC");
    value.setCalendarFields(
      sample.related,
      sample.year,
      sample.era,
      sample.month,
      sample.code,
      1,
      1,
    );
    const text = value.format(instant, true);
    if (text !== sample.expected)
      throw new Error("Prepared calendar symbols disagree: " + sample.calendar);
    let fields = 0;
    for (let index = 0; index < value.fieldCount(); index++) {
      if (value.start(index) < 0 || value.end(index) > text.length)
        throw new Error("Prepared calendar symbol span outside text");
      fields |= 1 << value.field(index);
    }
    if (fields !== 15) throw new Error("Prepared era/year/month/day span missing");
  }
  return (
    result +
    "\ninterval-data:order:fields:fallback:connector\ncalendar-symbols:era:month-code:ordinal-month"
  );
}
