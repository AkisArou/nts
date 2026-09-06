import { Headers, isToken } from "../fetch/headers.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import { ProtocolError, LimitError } from "../core/errors.ts";
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
    const text = part.trim();
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
      .some((value) => value.trim().toLowerCase() === token) ?? false
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
    if (transferEncoding.trim().toLowerCase() !== "chunked")
      throw new ProtocolError("Unsupported or ambiguous Transfer-Encoding");
    return { kind: "chunked", length: 0 };
  }
  return length === null ? { kind: "eof", length: 0 } : { kind: "fixed", length };
}
