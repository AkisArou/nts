import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, openSync, readSync, writeSync, closeSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, delimiter } from "node:path";
import type {
  CollationData,
  LocaleInfoData,
  DateTimeLocaleData,
} from "../../../runtime/ecmascript/src/intl/locale-data.ts";
import type { CollatorPrimitive } from "../../../runtime/ecmascript/src/intl/collation.ts";
import type { NumberFormatData } from "../../../runtime/ecmascript/src/intl/number-options.ts";
import type { NumberFormatterPrimitive } from "../../../runtime/ecmascript/src/intl/number.ts";
import type {
  DateTimePatternData,
  DateTimeFormatterPrimitive,
} from "../../../runtime/ecmascript/src/intl/date-time-data.ts";
import type { TimeZoneIdentifierData } from "../../../runtime/ecmascript/src/time/zone-data.ts";
import type { ListPatternData } from "../../../runtime/ecmascript/src/intl/list-data.ts";
import type { RelativeTimePrimitive } from "../../../runtime/ecmascript/src/intl/relative-data.ts";
import type { PluralRulesPrimitive } from "../../../runtime/ecmascript/src/intl/plural-data.ts";
import type { DurationPatternData } from "../../../runtime/ecmascript/src/intl/duration-data.ts";

// Supplementary host validation only. Production adapters call ICU directly;
// this synchronous bridge lets original Test262 run shared TS inside its realm.
export function icuHost(root: string) {
  const directory = mkdtempSync(resolve(tmpdir(), "nts-icu-host-"));
  const input = resolve(directory, "input");
  const output = resolve(directory, "output");
  execFileSync("mkfifo", [input, output]);
  const classes = resolve(root, "target/ecmascript/icu-check/java");
  const jar = resolve(root, "target/ecmascript/icu-check/icu4j-78.3.jar");
  const classpath = [classes, jar].join(delimiter);
  execFileSync("javac", [
    "--release",
    "11",
    "-cp",
    classpath,
    "-d",
    directory,
    resolve(root, "tooling/conformance/ecmascript/icu-compiled/Host.java"),
  ]);
  const child = spawn(
    "java",
    ["-Xverify:all", "-cp", [directory, classpath].join(delimiter), "Host", input, output],
    { stdio: "inherit" },
  );
  const writer = openSync(input, "w");
  const reader = openSync(output, "r");
  const buffer = Buffer.alloc(8192);
  let pending = "";
  function call(operation: string, ...arguments_: (string | number | boolean)[]): string | null {
    const request =
      operation +
      arguments_
        .map((value) => "\t" + Buffer.from(String(value), "utf16le").toString("base64"))
        .join("") +
      "\n";
    writeSync(writer, request);
    while (!pending.includes("\n")) {
      const count = readSync(reader, buffer);
      if (count === 0) throw new Error("ICU host provider exited before replying");
      pending += buffer.toString("utf8", 0, count);
    }
    const end = pending.indexOf("\n");
    const response = pending.slice(0, end);
    pending = pending.slice(end + 1);
    if (response === "null") return null;
    const tab = response.indexOf("\t");
    const value = Buffer.from(response.slice(tab + 1), "base64").toString("utf16le");
    if (response.slice(0, tab) !== "ok") throw new Error("ICU host provider: " + value);
    return value;
  }
  function required(operation: string, ...arguments_: (string | number | boolean)[]): string {
    const result = call(operation, ...arguments_);
    if (result === null) throw new Error("ICU host provider returned null for " + operation);
    return result;
  }
  const available = new Map<number, string>();
  const availableCount = Number(required("availableCount"));
  function values(operation: string, argument: string): string[] {
    const result = required(operation, argument);
    return result.length === 0 ? [] : result.split(";");
  }
  const zoneNames = required("timeZoneNames").split(";");
  const data: LocaleInfoData &
    DateTimeLocaleData &
    NumberFormatData &
    CollationData &
    ListPatternData &
    DurationPatternData &
    TimeZoneIdentifierData = {
    canonicalize: (tag) => required("canonicalize", tag),
    durationSamples: (tag) =>
      required("durationSamples", tag)
        .split(";")
        .map((sample) => Buffer.from(sample, "base64").toString("utf16le")),
    maximize: (tag) => required("maximize", tag),
    minimize: (tag) => required("minimize", tag),
    defaultLocale: () => required("defaultLocale"),
    availableCount: () => availableCount,
    availableLocale: (index) => {
      let tag = available.get(index);
      if (tag === undefined) {
        tag = required("availableLocale", index);
        available.set(index, tag);
      }
      return tag;
    },
    bestFit: (tag) => call("bestFit", tag) ?? undefined,
    defaultNumberingSystem: (locale) => required("defaultNumberingSystem", locale),
    hasNumberingSystem: (name) => required("hasNumberingSystem", name) === "true",
    currencyDigits: (currency) => Number(required("currencyDigits", currency)),
    canonicalType: (key, value) => required("canonicalType", key, value),
    calendarValues: (locale) => values("calendarValues", locale),
    availableCalendars: (locale) => values("availableCalendars", locale),
    collationValues: (locale) => values("collationValues", locale),
    collationDefaults: (locale) => Number(required("collationDefaults", locale)),
    hourCycle: (locale) => required("hourCycle", locale),
    timeZones: (region) => values("timeZones", region),
    textDirection: (script) => Number(required("textDirection", script)),
    weekData: (region) => Number(required("weekData", region)),
    isHebrew: (codePoint) => required("isHebrew", codePoint) === "true",
    listSamples: (locale, type, style, tokens) =>
      required("listSamples", locale, type, style, ...tokens)
        .split(";")
        .map((value) => Buffer.from(value, "base64").toString("utf16le")),
    timeZoneNames: () => zoneNames,
    canonicalTimeZone: (identifier) => call("canonicalTimeZone", identifier) ?? undefined,
    defaultTimeZoneIdentifier: () => required("defaultTimeZoneIdentifier"),
  };
  function openNumber(
    locale: string,
    skeleton: string,
    negativeSkeleton: string,
  ): NumberFormatterPrimitive {
    const handle = Number(required("open", locale, skeleton, negativeSkeleton));
    let spans: number[][] = [];
    function format(operation: string, ...arguments_: (string | number | boolean)[]): string {
      const parts = required(operation, handle, ...arguments_).split(";");
      spans = parts.slice(1).map((span) => span.split(",").map(Number));
      return Buffer.from(parts[0]!, "base64").toString("utf16le");
    }
    return {
      format: (value, fields, negative = false) =>
        format("format", Object.is(value, -0) ? "-0" : String(value), fields, negative),
      formatDecimal: (value, fields, negative = false) =>
        format("formatDecimal", value, fields, negative),
      formatRange: (start, end, fields, negativeStart = false, negativeEnd = false) =>
        format("formatRange", start, end, fields, negativeStart, negativeEnd),
      fieldCount: () => spans.length,
      field: (index) => spans[index]![0]!,
      start: (index) => spans[index]![1]!,
      end: (index) => spans[index]![2]!,
    };
  }
  function openCollator(
    locale: string,
    sensitivity: number,
    punctuation: boolean,
    numeric: boolean,
    caseFirst: number,
  ): CollatorPrimitive {
    const handle = Number(
      required("collatorOpen", locale, sensitivity, punctuation, numeric, caseFirst),
    );
    return { compare: (one, two) => Number(required("compare", handle, one, two)) };
  }
  function openPatterns(locale: string): DateTimePatternData {
    const handle = Number(required("patternOpen", locale));
    return {
      bestPattern: (skeleton) => required("bestPattern", handle, skeleton),
      stylePattern: (dateStyle, timeStyle) =>
        required("stylePattern", handle, dateStyle, timeStyle),
      patterns: () => required("patterns", handle).split(";"),
    };
  }
  function openDate(locale: string, pattern: string, timeZone: string): DateTimeFormatterPrimitive {
    const handle = Number(required("dateOpen", locale, pattern, timeZone));
    let spans: number[][] = [];
    function format(operation: string, ...arguments_: (string | number | boolean)[]): string {
      const parts = required(operation, handle, ...arguments_).split(";");
      spans = parts.slice(1).map((span) => span.split(",").map(Number));
      return Buffer.from(parts[0]!, "base64").toString("utf16le");
    }
    return {
      format: (milliseconds, fields) => format("dateFormat", milliseconds, fields),
      formatRange: (start, end, fields) => format("dateRange", start, end, fields),
      fieldCount: () => spans.length,
      field: (index) => spans[index]![0]!,
      start: (index) => spans[index]![1]!,
      end: (index) => spans[index]![2]!,
    };
  }
  function openPlural(
    locale: string,
    ordinal: boolean,
    skeleton: string,
    negativeSkeleton: string,
  ): PluralRulesPrimitive {
    const handle = Number(required("pluralOpen", locale, ordinal, skeleton, negativeSkeleton));
    return {
      categories: () => Number(required("pluralCategories", handle)),
      select: (value, negative) =>
        Number(
          required("pluralSelect", handle, Object.is(value, -0) ? "-0" : String(value), negative),
        ),
      selectDecimal: (value, negative) =>
        Number(required("pluralDecimal", handle, value, negative)),
      selectRange: (start, end, negativeStart, negativeEnd) =>
        Number(required("pluralRange", handle, start, end, negativeStart, negativeEnd)),
    };
  }
  function openRelative(locale: string, style: number): RelativeTimePrimitive {
    const handle = Number(required("relativeOpen", locale, style));
    let spans: number[][] = [];
    return {
      format: (value, unit, auto, fields) => {
        const response = required(
          "relativeFormat",
          handle,
          Object.is(value, -0) ? "-0" : String(value),
          unit,
          auto,
          fields,
        ).split(";");
        spans = response.slice(1).map((span) => span.split(",").map(Number));
        return Buffer.from(response[0]!, "base64").toString("utf16le");
      },
      fieldCount: () => spans.length,
      field: (index) => spans[index]![0]!,
      start: (index) => spans[index]![1]!,
      end: (index) => spans[index]![2]!,
    };
  }
  let closed = false;
  return {
    data,
    openNumber,
    openCollator,
    openPatterns,
    openDate,
    openRelative,
    openPlural,
    reset: () => {
      required("reset");
    },
    close: () => {
      if (closed) return;
      closed = true;
      closeSync(writer);
      closeSync(reader);
      child.kill();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
