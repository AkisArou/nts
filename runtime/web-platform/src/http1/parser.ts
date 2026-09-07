import { trimHTTPTabOrSpace } from "../core/ascii.ts";
import { LimitError, ProtocolError } from "../core/errors.ts";
import { Headers, isToken } from "../fetch/headers.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import { contentLength } from "../http/fields.ts";
import type { BufferedReader } from "./io.ts";

export { contentLength, hasToken } from "../http/fields.ts";

export interface HeadLimits {
  maxHeaderBytes: number;
  maxHeaders: number;
  maxInformational: number;
}

export const defaultHeadLimits: HeadLimits = {
  maxHeaderBytes: 32768,
  maxHeaders: 256,
  maxInformational: 16,
};

export interface ResponseHead {
  version: "1.0" | "1.1";
  status: number;
  statusText: string;
  headers: HeaderEntry[];
}

export function validateWireValue(value: string): void {
  for (let i = 0; i < value.length; ++i) {
    const c = value.charCodeAt(i);
    if ((c < 32 && c !== 9) || c === 127 || c > 255) {
      throw new ProtocolError("Invalid HTTP field value");
    }
  }
}

export async function readHeaderFields(
  reader: BufferedReader,
  limits: HeadLimits,
  initialBytes = 0,
): Promise<HeaderEntry[]> {
  const headers: HeaderEntry[] = [];
  let bytes = initialBytes;

  while (true) {
    const line = await reader.line(limits.maxHeaderBytes - bytes);
    bytes += line.length + 2;
    if (line === "") {
      return headers;
    }
    if (headers.length >= limits.maxHeaders) {
      throw new LimitError("Too many HTTP headers");
    }
    const colon = line.indexOf(":");
    const name = line.slice(0, colon);
    if (colon <= 0 || !isToken(name)) {
      throw new ProtocolError("Malformed HTTP header or obsolete folding");
    }
    const value = line.slice(colon + 1);
    validateWireValue(value);
    headers.push([name.toLowerCase(), trimHTTPTabOrSpace(value)]);
  }
}

export async function readHead(
  reader: BufferedReader,
  limits: HeadLimits = defaultHeadLimits,
): Promise<ResponseHead> {
  const line = await reader.line(limits.maxHeaderBytes);
  if (
    line.length < 13 ||
    line.slice(0, 5) !== "HTTP/" ||
    line.charCodeAt(8) !== 32 ||
    line.charCodeAt(12) !== 32
  ) {
    throw new ProtocolError("Malformed HTTP response status line");
  }
  const version = line.slice(5, 8);
  const first = line.charCodeAt(9) - 48;
  const second = line.charCodeAt(10) - 48;
  const third = line.charCodeAt(11) - 48;
  if (
    (version !== "1.0" && version !== "1.1") ||
    first < 0 ||
    first > 9 ||
    second < 0 ||
    second > 9 ||
    third < 0 ||
    third > 9
  ) {
    throw new ProtocolError("Invalid HTTP status line");
  }

  const statusText = line.slice(13);
  validateWireValue(statusText);
  const status = first * 100 + second * 10 + third;

  if (status < 100 || status > 599) {
    throw new ProtocolError("Unsupported HTTP status code");
  }
  return {
    version,
    status,
    statusText,
    headers: await readHeaderFields(reader, limits, line.length + 2),
  };
}

export function responseFraming(headers: Headers): {
  kind: "chunked" | "fixed" | "eof";
  length: number;
} {
  const length = contentLength(headers);
  const transferEncoding = headers.get("transfer-encoding");

  if (transferEncoding !== null) {
    if (length !== null) {
      throw new ProtocolError("Ambiguous Transfer-Encoding and Content-Length");
    }
    if (trimHTTPTabOrSpace(transferEncoding).toLowerCase() !== "chunked") {
      throw new ProtocolError("Unsupported or ambiguous Transfer-Encoding");
    }
    return { kind: "chunked", length: 0 };
  }
  return length === null ? { kind: "eof", length: 0 } : { kind: "fixed", length };
}

function isTabOrSpace(code: number): boolean {
  return code === 9 || code === 32;
}

function isQuotedText(code: number): boolean {
  return (
    code === 9 ||
    code === 32 ||
    code === 33 ||
    (code >= 35 && code <= 91) ||
    (code >= 93 && code <= 126) ||
    code >= 128
  );
}

function isQuotedPairValue(code: number): boolean {
  return code === 9 || code === 32 || (code >= 33 && code <= 126) || code >= 128;
}

function skipBadWhitespace(line: string, start: number): number {
  let index = start;
  while (index < line.length && isTabOrSpace(line.charCodeAt(index))) {
    index++;
  }
  return index;
}

function skipChunkExtensionValue(line: string, start: number): number {
  if (line.charCodeAt(start) !== 34) {
    let end = start;
    while (
      end < line.length &&
      !isTabOrSpace(line.charCodeAt(end)) &&
      line.charCodeAt(end) !== 59
    ) {
      end++;
    }
    if (!isToken(line.slice(start, end))) {
      throw new ProtocolError("Invalid HTTP chunk extension");
    }
    return end;
  }

  let index = start + 1;
  while (index < line.length) {
    const code = line.charCodeAt(index++);
    if (code === 34) {
      return index;
    }
    if (code === 92) {
      if (index === line.length || !isQuotedPairValue(line.charCodeAt(index++))) {
        throw new ProtocolError("Invalid HTTP chunk extension escape");
      }
    } else if (!isQuotedText(code)) {
      throw new ProtocolError("Invalid HTTP chunk extension string");
    }
  }
  throw new ProtocolError("Unterminated HTTP chunk extension string");
}

function hexDigit(code: number): number {
  if (code >= 48 && code <= 57) {
    return code - 48;
  }
  if (code >= 65 && code <= 70) {
    return code - 55;
  }
  if (code >= 97 && code <= 102) {
    return code - 87;
  }
  return -1;
}

/** Parse an RFC 9112 chunk-size line and validate ignored chunk extensions. */
export function parseChunkSize(line: string): number {
  validateWireValue(line);
  let index = 0;
  let size = 0;

  while (index < line.length) {
    const digit = hexDigit(line.charCodeAt(index));
    if (digit < 0) {
      break;
    }
    size = size * 16 + digit;
    index++;
  }
  if (index === 0) {
    throw new ProtocolError("Invalid HTTP chunk size");
  }

  while (index < line.length) {
    index = skipBadWhitespace(line, index);
    if (index === line.length || line.charCodeAt(index++) !== 59) {
      throw new ProtocolError("Invalid HTTP chunk extension delimiter");
    }

    index = skipBadWhitespace(line, index);
    const nameStart = index;
    while (
      index < line.length &&
      !isTabOrSpace(line.charCodeAt(index)) &&
      line.charCodeAt(index) !== 59 &&
      line.charCodeAt(index) !== 61
    ) {
      index++;
    }
    if (!isToken(line.slice(nameStart, index))) {
      throw new ProtocolError("Invalid HTTP chunk extension name");
    }

    const nameEnd = index;
    index = skipBadWhitespace(line, index);
    if (index === line.length && index !== nameEnd) {
      throw new ProtocolError("Invalid trailing whitespace in HTTP chunk extension");
    }
    if (index < line.length && line.charCodeAt(index) === 61) {
      index = skipBadWhitespace(line, index + 1);
      if (index === line.length) {
        throw new ProtocolError("Missing HTTP chunk extension value");
      }
      index = skipChunkExtensionValue(line, index);
    }
  }

  if (!Number.isSafeInteger(size)) {
    throw new LimitError("HTTP chunk is too large");
  }
  return size;
}
