import { epochDays } from "../../../../runtime/ecmascript/src/date/calendar.ts";

function isoDay(year: number, month: number, day: number): number {
  return epochDays(year, month - 1, day);
}

// Public cases from Intl Temporal PlainDate month-code/day-boundary Test262,
// checked through the compiled packed-data cursor as well as the public API.
export const calendarTableCases = [
  { calendar: "chinese", day: isoDay(1987, 7, 26), expected: "1987:7:1:M06L" },
  { calendar: "chinese", day: isoDay(2027, 2, 6), expected: "2027:1:1:M01" },
  { calendar: "chinese", day: isoDay(2030, 2, 3), expected: "2030:1:1:M01" },
];

// Fixed data/ABI goldens. Original Test262 remains the public semantic corpus.
export const calendarCases = [
  {
    calendar: "gregory",
    day: isoDay(2024, 2, 29),
    expected: "2024:2:29:M02:60:29:366:12:1:ce:2024",
  },
  {
    calendar: "buddhist",
    day: isoDay(2024, 2, 29),
    expected: "2567:2:29:M02:60:29:366:12:1:be:2567",
  },
  { calendar: "roc", day: isoDay(2024, 2, 29), expected: "113:2:29:M02:60:29:366:12:1:roc:113" },
  { calendar: "japanese", day: 18016, expected: "2019:4:30:M04:120:30:365:12:0:heisei:31" },
  { calendar: "japanese", day: 18017, expected: "2019:5:1:M05:121:31:365:12:0:reiwa:1" },
  { calendar: "japanese", day: -15714, expected: "1926:12:24:M12:358:31:365:12:0:taisho:15" },
  { calendar: "japanese", day: -15713, expected: "1926:12:25:M12:359:31:365:12:0:showa:1" },
  {
    calendar: "hebrew",
    day: isoDay(2024, 2, 10),
    expected: "5784:6:1:M05L:148:30:383:13:1:am:5784",
  },
  {
    calendar: "chinese",
    day: isoDay(2023, 3, 22),
    expected: "2023:3:1:M02L:60:29:384:13:1:undefined:undefined",
  },
  {
    calendar: "dangi",
    day: isoDay(2023, 3, 22),
    expected: "2023:3:1:M02L:60:29:384:13:1:undefined:undefined",
  },
  {
    calendar: "coptic",
    day: isoDay(2024, 9, 10),
    expected: "1740:13:5:M13:365:5:365:13:0:am:1740",
  },
  {
    calendar: "ethiopic",
    day: isoDay(2024, 9, 10),
    expected: "2016:13:5:M13:365:5:365:13:0:am:2016",
  },
  {
    calendar: "ethioaa",
    day: isoDay(2024, 9, 10),
    expected: "7516:13:5:M13:365:5:365:13:0:aa:7516",
  },
  {
    calendar: "indian",
    day: isoDay(2024, 3, 21),
    expected: "1946:1:1:M01:1:31:366:12:1:shaka:1946",
  },
  {
    calendar: "islamic-civil",
    day: isoDay(622, 7, 19),
    expected: "1:1:1:M01:1:30:354:12:0:ah:1",
  },
  {
    calendar: "islamic-tbla",
    day: isoDay(622, 7, 18),
    expected: "1:1:1:M01:1:30:354:12:0:ah:1",
  },
  {
    calendar: "persian",
    day: isoDay(2024, 3, 20),
    expected: "1403:1:1:M01:1:31:366:12:1:ap:1403",
  },
  { calendar: "gregory", day: isoDay(0, 1, 1), expected: "0:1:1:M01:1:31:366:12:1:bce:1" },
  {
    calendar: "japanese",
    day: isoDay(1872, 12, 31),
    expected: "1872:12:31:M12:366:31:366:12:1:ce:1872",
  },
  {
    calendar: "japanese",
    day: isoDay(1873, 1, 1),
    expected: "1873:1:1:M01:1:31:365:12:0:meiji:6",
  },
  {
    calendar: "gregory",
    day: isoDay(1582, 10, 10),
    expected: "1582:10:10:M10:283:31:365:12:0:ce:1582",
  },
];

export const calendarIdentifiers = [
  "buddhist",
  "chinese",
  "coptic",
  "dangi",
  "ethioaa",
  "ethiopic",
  "gregory",
  "hebrew",
  "indian",
  "islamic-civil",
  "islamic-tbla",
  "islamic-umalqura",
  "japanese",
  "persian",
  "roc",
];
