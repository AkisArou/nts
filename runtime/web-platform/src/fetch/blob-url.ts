import type { Blob } from "../file/blob.ts";
import type { HeaderEntry } from "./headers.ts";

const RANGE_NUMBER_CAP = Number.MAX_SAFE_INTEGER + 1;

export class BlobURLResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly HeaderEntry[];
  readonly body: Blob;

  constructor(status: number, statusText: string, headers: readonly HeaderEntry[], body: Blob) {
    this.status = status;
    this.statusText = statusText;
    this.headers = headers;
    this.body = body;
  }
}

class ParsedRange {
  readonly start: number | null;
  readonly end: number | null;

  constructor(start: number | null, end: number | null) {
    this.start = start;
    this.end = end;
  }
}

class DecimalResult {
  readonly value: number | null;
  readonly next: number;

  constructor(value: number | null, next: number) {
    this.value = value;
    this.next = next;
  }
}

/** Apply Fetch's blob-scheme response algorithm. Null is a network error. */
export function fetchBlob(blob: Blob, rangeHeader: string | null): BlobURLResponse | null {
  const fullLength = blob.size;
  const type = blob.type;
  if (rangeHeader === null) {
    return new BlobURLResponse(
      200,
      "OK",
      [
        ["content-length", String(fullLength)],
        ["content-type", type],
      ],
      blob,
    );
  }

  const range = parseSingleRange(rangeHeader);
  if (range === null) {
    return null;
  }

  let start = range.start;
  let end = range.end;
  if (start === null) {
    const suffixLength = end;
    if (suffixLength === null) {
      return null;
    }
    start = fullLength - suffixLength;
    end = fullLength - 1;
  } else {
    if (start >= fullLength) {
      return null;
    }
    if (end === null || end >= fullLength) {
      end = fullLength - 1;
    }
  }

  const sliced = blob.slice(start, end + 1, type);
  return new BlobURLResponse(
    206,
    "Partial Content",
    [
      ["content-length", String(sliced.size)],
      ["content-type", type],
      ["content-range", `bytes ${start}-${end}/${fullLength}`],
    ],
    sliced,
  );
}

/** Fetch's exact single-range parser with HTTP tab/space permitted around separators. */
function parseSingleRange(input: string): ParsedRange | null {
  if (!input.startsWith("bytes")) {
    return null;
  }
  let position = skipTabOrSpace(input, 5);
  if (input.charAt(position) !== "=") {
    return null;
  }
  position = skipTabOrSpace(input, position + 1);
  const start = readDecimal(input, position);
  position = skipTabOrSpace(input, start.next);
  if (input.charAt(position) !== "-") {
    return null;
  }
  position = skipTabOrSpace(input, position + 1);
  const end = readDecimal(input, position);
  if (end.next !== input.length) {
    return null;
  }
  if (start.value === null && end.value === null) {
    return null;
  }
  if (start.value !== null && end.value !== null && start.value > end.value) {
    return null;
  }
  return new ParsedRange(start.value, end.value);
}

function skipTabOrSpace(input: string, start: number): number {
  let position = start;
  while (position < input.length) {
    const code = input.charCodeAt(position);
    if (code !== 0x09 && code !== 0x20) {
      break;
    }
    position++;
  }
  return position;
}

function readDecimal(input: string, start: number): DecimalResult {
  let position = start;
  let value = 0;
  while (position < input.length) {
    const code = input.charCodeAt(position);
    if (code < 0x30 || code > 0x39) {
      break;
    }
    if (value < RANGE_NUMBER_CAP) {
      value = Math.min(RANGE_NUMBER_CAP, value * 10 + code - 0x30);
    }
    position++;
  }
  return new DecimalResult(position === start ? null : value, position);
}
