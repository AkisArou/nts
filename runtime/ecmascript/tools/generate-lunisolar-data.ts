// Repack licensed, pinned year data. No astronomical engine or host calendar
// implementation is embedded in the shared runtime.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { epochDays } from "../src/date/calendar.ts";

const root = resolve(import.meta.dirname, "../../..");
const base = resolve(root, "runtime/ecmascript");
const pin = JSON.parse(
  readFileSync(resolve(base, "third_party/lunisolar-sources.json"), "utf8"),
) as {
  repository: string;
  revision: string;
  directory: string;
  sources: Record<string, string>;
  licenseSha256: string;
  boundary: {
    icuVersion: string;
    year: number;
    newYear: [number, number, number];
    monthLengths: number[];
  };
};
for (const argument of process.argv.slice(2))
  if (argument !== "--check") throw new Error("Unknown option: " + argument);
function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
if (hash(readFileSync(resolve(base, "third_party/ICU4X-LICENSE"))) !== pin.licenseSha256)
  throw new Error("Lunisolar license drift");
const versions = JSON.parse(readFileSync(resolve(base, "providers/icu/versions.json"), "utf8"));
if (pin.boundary.icuVersion !== versions.icu)
  throw new Error("Lunisolar boundary provider version drift");
const directory = resolve(root, "target/ecmascript/lunisolar-pin", pin.revision);
mkdirSync(directory, { recursive: true });

interface YearData {
  first: number;
  length: number;
  packed: number;
}
function pack(year: number, lengths: number[], leap: number, first: number): YearData {
  const count = leap === 0 ? 12 : 13;
  const offset = first - epochDays(year, 0, 21);
  if (
    lengths.length !== count ||
    !Number.isInteger(leap) ||
    leap === 1 ||
    leap < 0 ||
    leap > 13 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 31
  )
    throw new Error("Invalid lunisolar year " + year);
  let mask = 0;
  let length = 0;
  for (let month = 0; month < count; month++) {
    const days = lengths[month]!;
    if (days !== 29 && days !== 30) throw new Error("Invalid lunisolar month " + year);
    length += days;
    if (days === 30) mask |= 1 << month;
  }
  return { first, length, packed: mask | (leap << 13) | (offset << 17) };
}

async function source(name: string): Promise<Map<number, YearData>> {
  const expected = pin.sources[name];
  if (!expected) throw new Error("Unpinned lunisolar source " + name);
  const cache = resolve(directory, name);
  if (!existsSync(cache)) {
    const response = await fetch(
      "https://raw.githubusercontent.com/unicode-org/icu4x/" +
        pin.revision +
        "/" +
        pin.directory +
        "/" +
        name,
    );
    if (!response.ok) throw new Error("Lunisolar download: " + response.status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (hash(bytes) !== expected) throw new Error("Lunisolar download hash mismatch: " + name);
    writeFileSync(cache, bytes);
  }
  const bytes = readFileSync(cache);
  if (hash(bytes) !== expected) throw new Error("Lunisolar cached hash mismatch: " + name);
  const data = new Map<number, YearData>();
  const expression =
    /PackedEastAsianTraditionalYearData::new\((\d+), \[([ls, ]+)\], (None|Some\((\d+)\)), gregorian\((\d+), (\d+), (\d+)\)\)/g;
  for (const match of bytes.toString("utf8").matchAll(expression)) {
    const year = Number(match[1]);
    const leap = Number(match[4] ?? 0);
    const months = match[2]!.split(",").map((month) => month.trim());
    if (data.has(year) || Number(match[5]) !== year || months.length !== 13)
      throw new Error("Malformed lunisolar source " + name + ": " + year);
    data.set(
      year,
      pack(
        year,
        months.slice(0, leap === 0 ? 12 : 13).map((month) => (month === "l" ? 30 : 29)),
        leap,
        epochDays(year, Number(match[6]) - 1, Number(match[7])),
      ),
    );
  }
  if (data.size === 0) throw new Error("Missing lunisolar rows: " + name);
  return data;
}

const [qing, chinese, korean] = await Promise.all([
  source("qing_data.rs"),
  source("china_data.rs"),
  source("korea_data.rs"),
]);
const boundary = pin.boundary;
if (boundary.year !== 1899 || boundary.newYear[0] !== boundary.year)
  throw new Error("Invalid lunisolar boundary year");
qing.set(
  boundary.year,
  pack(
    boundary.year,
    boundary.monthLengths,
    0,
    epochDays(boundary.newYear[0], boundary.newYear[1] - 1, boundary.newYear[2]),
  ),
);
function rows(data: Map<number, YearData>, first: number, last: number): number[] {
  const packed: number[] = [];
  for (let year = first; year <= last; year++) {
    const row = data.get(year);
    if (!row) throw new Error("Missing lunisolar year " + year);
    const next = data.get(year + 1);
    if (next && row.first + row.length !== next.first)
      throw new Error("Discontinuous lunisolar year " + year);
    packed.push(row.packed);
  }
  return packed;
}
for (const modern of [chinese, korean])
  if (qing.get(1911)!.first + qing.get(1911)!.length !== modern.get(1912)!.first)
    throw new Error("Discontinuous lunisolar source boundary");
const payload = {
  QING_YEARS: rows(qing, 1899, 1911),
  CHINESE_YEARS: rows(chinese, 1912, 2101),
  KOREAN_YEARS: rows(korean, 1912, 2051),
};
let output = "// Generated by tools/generate-lunisolar-data.ts; do not edit.\n";
output += "// ICU4X " + pin.revision + "; hashes in third_party/lunisolar-sources.json.\n";
output += "// Copyright 2020-2024 Unicode, Inc. SPDX-License-Identifier: Unicode-3.0.\n";
output += "// See ../../third_party/ICU4X-LICENSE. Boundary year: public ICU 78.3 data.\n";
output += "// Bits: long months 0..12, leap ordinal 13..16, New Year after Jan 21 17..21.\n";
for (const [name, values] of Object.entries(payload)) {
  output += "export const " + name + " = new Uint32Array([\n";
  for (let index = 0; index < values.length; index += 10)
    output +=
      "  " +
      values
        .slice(index, index + 10)
        .map((value) => "0x" + value.toString(16))
        .join(", ") +
      ",\n";
  output += "]);\n";
}
const target = resolve(base, "src/temporal/lunisolar-data.ts");
const check = process.argv.includes("--check");
if (check) {
  if (!existsSync(target) || readFileSync(target, "utf8") !== output)
    throw new Error("Lunisolar data drift");
} else writeFileSync(target, output);
process.stdout.write(
  JSON.stringify({
    mode: check ? "lunisolar-check" : "lunisolar-generate",
    revision: pin.revision,
    packedBytes: Object.values(payload).reduce((sum, values) => sum + values.length * 4, 0),
  }) + "\n",
);
