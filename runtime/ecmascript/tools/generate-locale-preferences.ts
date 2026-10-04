// Only the preference availability/order absent from public ICU queries is
// retained. Names, calendars, week values and other locale data stay in ICU.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const pin = JSON.parse(
  readFileSync(resolve(root, "runtime/ecmascript/providers/icu/artifacts.json"), "utf8"),
).cldrSupplemental as {
  version: string;
  url: string;
  sha256: string;
  licenseSha256: string;
};
const versions = JSON.parse(
  readFileSync(resolve(root, "runtime/ecmascript/providers/icu/versions.json"), "utf8"),
);
if (pin.version !== versions.cldr) throw new Error("CLDR version drift");
if (
  createHash("sha256")
    .update(readFileSync(resolve(root, "runtime/ecmascript/third_party/UNICODE-LICENSE")))
    .digest("hex") !== pin.licenseSha256
)
  throw new Error("CLDR license drift");
for (const argument of process.argv.slice(2))
  if (argument !== "--check") throw new Error("Unknown option: " + argument);
const directory = resolve(root, "target/ecmascript/cldr-pin");
mkdirSync(directory, { recursive: true });
const cache = resolve(directory, "supplementalData.xml");
if (!existsSync(cache)) {
  const response = await fetch(pin.url);
  if (!response.ok) throw new Error("CLDR download: " + response.status);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== pin.sha256)
    throw new Error("CLDR download hash mismatch");
  writeFileSync(cache, bytes);
}
const bytes = readFileSync(cache);
if (createHash("sha256").update(bytes).digest("hex") !== pin.sha256)
  throw new Error("CLDR cached hash mismatch");
const xml = bytes.toString("utf8").replace(/<!--[\s\S]*?-->/g, "");
function section(name: string): string {
  const start = xml.indexOf("<" + name + ">"),
    end = xml.indexOf("</" + name + ">", start);
  if (start < 0 || end < 0) throw new Error("Missing CLDR section " + name);
  return xml.slice(start, end);
}
function entries(sectionName: string, name: string): Record<string, string>[] {
  const result: Record<string, string>[] = [];
  const expression = new RegExp("<" + name + "\\s+([^>]+?)/>", "g");
  for (const match of section(sectionName).matchAll(expression)) {
    const attributes: Record<string, string> = {};
    for (const attribute of match[1]!.matchAll(/([A-Za-z]+)="([^"]*)"/g))
      attributes[attribute[1]!] = attribute[2]!;
    if (attributes.alt === undefined) result.push(attributes);
  }
  if (result.length === 0) throw new Error("Missing CLDR entries " + name);
  return result;
}
function regions(entries: Record<string, string>[], key: string): Set<string> {
  const result = new Set<string>();
  for (const entry of entries) {
    if (!entry[key]) throw new Error("Missing CLDR region attribute");
    for (const region of entry[key]!.trim().split(/\s+/)) {
      if (!/^([A-Z]{2}|[0-9]{3})$/.test(region))
        throw new Error("Unexpected CLDR region " + region);
      result.add(region);
    }
  }
  return result;
}
function packed(keys: Iterable<string>): string {
  return [...keys]
    .map((key) => key.padEnd(3, "_"))
    .sort()
    .join("");
}
const calendar = regions(entries("calendarPreferenceData", "calendarPreference"), "territories");
const week = regions(
  [
    ...entries("weekData", "firstDay"),
    ...entries("weekData", "weekendStart"),
    ...entries("weekData", "weekendEnd"),
  ],
  "territories",
);
const hour = new Map<string, string>();
for (const entry of entries("timeData", "hours")) {
  if (!entry.allowed || !entry.regions) throw new Error("Missing CLDR hours");
  let cycles = "";
  // allowed is already in preference order. Flexible day periods share the
  // same hour cycle; preferred describes j, while this API exposes all cycles.
  for (const format of entry.allowed.trim().split(/\s+/)) {
    const symbol = format.charAt(0);
    const cycle =
      symbol === "K"
        ? "1"
        : symbol === "h"
          ? "2"
          : symbol === "H"
            ? "3"
            : symbol === "k"
              ? "4"
              : "";
    if (!cycle) throw new Error("Unexpected CLDR hour format " + format);
    if (!cycles.includes(cycle)) cycles += cycle;
  }
  for (const raw of entry.regions.trim().split(/\s+/)) {
    const key = raw.replaceAll("_", "-");
    if (!/^([A-Z]{2}|[0-9]{3}|[a-z]{2,8}-([A-Z]{2}|[0-9]{3}))$/.test(key))
      throw new Error("Unexpected CLDR time key " + key);
    if (hour.has(key)) throw new Error("Duplicate CLDR time key " + key);
    hour.set(key, cycles);
  }
}
const patterns = [...new Set(hour.values())].sort();
const hourRegions = [...hour.keys()].filter((key) => !key.includes("-")).sort();
const hourLocales = [...hour.keys()].filter((key) => key.includes("-")).sort();
function codes(keys: string[]): string {
  return keys.map((key) => String.fromCharCode(97 + patterns.indexOf(hour.get(key)!))).join("");
}
const payload = {
  calendarRegions: packed(calendar),
  weekRegions: packed(week),
  hourRegions: packed(hourRegions),
  hourRegionCodes: codes(hourRegions),
  hourLocales,
  hourLocaleCodes: codes(hourLocales),
  hourPatterns: patterns.map((pattern) =>
    [...pattern].map((cycle) =>
      cycle === "1" ? "h11" : cycle === "2" ? "h12" : cycle === "3" ? "h23" : "h24",
    ),
  ),
};
if (!calendar.has("001") || !week.has("001") || !hour.has("001"))
  throw new Error("Missing world preference defaults");
let output = "// Generated by tools/generate-locale-preferences.ts; do not edit.\n";
output += "// CLDR " + pin.version + "; supplementalData.xml SHA-256 " + pin.sha256 + ".\n";
output += "// Copyright Unicode, Inc. SPDX-License-Identifier: Unicode-3.0.\n";
output +=
  "// See ../../../third_party/UNICODE-LICENSE. Only unavailable ICU preference metadata.\n";
for (const [name, value] of Object.entries(payload))
  output +=
    "export const " +
    name +
    " = " +
    JSON.stringify(value) +
    (Array.isArray(value) ? " as const" : "") +
    ";\n";
const target = resolve(root, "runtime/ecmascript/providers/icu/shared/locale-preference-data.ts");
mkdirSync(resolve(target, ".."), { recursive: true });
if (process.argv.includes("--check")) {
  if (!existsSync(target) || readFileSync(target, "utf8") !== output)
    throw new Error("Locale preference data drift");
} else writeFileSync(target, output);
process.stdout.write(
  JSON.stringify({
    mode: process.argv.includes("--check")
      ? "locale-preferences-check"
      : "locale-preferences-generate",
    cldr: pin.version,
    calendarRegions: calendar.size,
    weekRegions: week.size,
    hourRegions: hourRegions.length,
    hourLocales: hourLocales.length,
    hourPatterns: patterns.length,
    payloadBytes: Buffer.byteLength(JSON.stringify(payload)),
    moduleBytes: Buffer.byteLength(output),
  }) + "\n",
);
