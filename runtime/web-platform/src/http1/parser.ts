import { Headers, isToken } from "../fetch/headers.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import { ProtocolError, LimitError } from "../core/errors.ts";
import { trimHTTPTabOrSpace } from "../core/ascii.ts";
import type { BufferedReader } from "./io.ts";

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
    if ((c < 32 && c !== 9) || c === 127 || c > 255)
      throw new ProtocolError("Invalid HTTP field value");
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
    if (line === "") return headers;
    if (headers.length >= limits.maxHeaders) throw new LimitError("Too many HTTP headers");
    const colon = line.indexOf(":");
    const name = line.slice(0, colon);
    if (colon <= 0 || !isToken(name))
      throw new ProtocolError("Malformed HTTP header or obsolete folding");
    const value = line.slice(colon + 1);
    validateWireValue(value);
    const normalized = new Headers([[name, value]]).raw()[0];
    if (normalized !== undefined) headers.push(normalized);
  }
}
export async function readHead(
  reader: BufferedReader,
  limits: HeadLimits = defaultHeadLimits,
): Promise<ResponseHead> {
  const line = await reader.line(limits.maxHeaderBytes);
  const match = /^HTTP\/(1\.[01]) ([0-9]{3}) (.*)$/.exec(line);

  if (match === null) throw new ProtocolError("Malformed HTTP response status line");
  const version = match[1];
  const statusText = match[3];
  const statusTextNumber = match[2];

  if (
    (version !== "1.0" && version !== "1.1") ||
    statusText === undefined ||
    statusTextNumber === undefined
  )
    throw new ProtocolError("Invalid HTTP status line");

  validateWireValue(statusText);
  const status = Number(statusTextNumber);

  if (status < 100 || status > 599) throw new ProtocolError("Unsupported HTTP status code");
  return {
    version,
    status,
    statusText,
    headers: await readHeaderFields(reader, limits, line.length + 2),
  };
}

export function contentLength(headers: Headers): number | null {
  const raw = headers.get("content-length");

  if (raw === null) return null;
  let result: number | null = null;

  for (const part of raw.split(",")) {
    const text = trimHTTPTabOrSpace(part);
    if (!/^[0-9]+$/.test(text)) throw new ProtocolError("Invalid Content-Length");
    const length = Number(text);
    if (!Number.isSafeInteger(length)) throw new ProtocolError("Content-Length is too large");
    if (result !== null && result !== length)
      throw new ProtocolError("Conflicting Content-Length fields");
    result = length;
  }
  return result;
}

export function hasToken(headers: Headers, name: string, token: string): boolean {
  return (
    headers
      .get(name)
      ?.split(",")
      .some((value) => trimHTTPTabOrSpace(value).toLowerCase() === token) ?? false
  );
}

export function responseFraming(headers: Headers): {
  kind: "chunked" | "fixed" | "eof";
  length: number;
} {
  const length = contentLength(headers);
  const transferEncoding = headers.get("transfer-encoding");

  if (transferEncoding !== null) {
    if (length !== null) throw new ProtocolError("Ambiguous Transfer-Encoding and Content-Length");
    if (trimHTTPTabOrSpace(transferEncoding).toLowerCase() !== "chunked")
      throw new ProtocolError("Unsupported or ambiguous Transfer-Encoding");
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
  while (index < line.length && isTabOrSpace(line.charCodeAt(index))) index++;
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
    if (!isToken(line.slice(start, end))) throw new ProtocolError("Invalid HTTP chunk extension");
    return end;
  }

  let index = start + 1;
  while (index < line.length) {
    const code = line.charCodeAt(index++);
    if (code === 34) return index;
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

/** Parse an RFC 9112 chunk-size line and validate ignored chunk extensions. */
export function parseChunkSize(line: string): number {
  validateWireValue(line);
  let index = 0;

  while (index < line.length) {
    const code = line.charCodeAt(index);
    if ((code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102)) {
      index++;
    } else {
      break;
    }
  }
  if (index === 0) throw new ProtocolError("Invalid HTTP chunk size");
  const numeral = line.slice(0, index);

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
      if (index === line.length) throw new ProtocolError("Missing HTTP chunk extension value");
      index = skipChunkExtensionValue(line, index);
    }
  }

  const size = Number.parseInt(numeral, 16);
  if (!Number.isSafeInteger(size)) throw new LimitError("HTTP chunk is too large");
  return size;
}
