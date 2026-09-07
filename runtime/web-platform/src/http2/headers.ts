import type { DecodedHpackHeaderField, HpackHeaderField } from "./hpack.ts";
import { HTTP2_PROTOCOL_ERROR, Http2WireError } from "./frame.ts";

export interface Http2ResponseHeaders {
  readonly status: number;
  readonly headers: readonly DecodedHpackHeaderField[];
  readonly contentLength: number | null;
}

const forbiddenConnectionFields: readonly string[] = [
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
];

function streamProtocolError(message: string, streamId: number): never {
  throw new Http2WireError(message, HTTP2_PROTOCOL_ERROR, streamId);
}

function isLowercaseFieldName(name: string): boolean {
  const start = name.startsWith(":") ? 1 : 0;
  if (start === name.length) return false;
  for (let index = start; index < name.length; index++) {
    const code = name.charCodeAt(index);
    if (
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 33 ||
      code === 35 ||
      code === 36 ||
      code === 37 ||
      code === 38 ||
      code === 39 ||
      code === 42 ||
      code === 43 ||
      code === 45 ||
      code === 46 ||
      code === 94 ||
      code === 95 ||
      code === 96 ||
      code === 124 ||
      code === 126
    ) {
      continue;
    }
    return false;
  }
  return true;
}

function asciiEqualsIgnoreCase(value: string, expectedLowercase: string): boolean {
  if (value.length !== expectedLowercase.length) return false;
  for (let index = 0; index < value.length; index++) {
    let code = value.charCodeAt(index);
    if (code >= 65 && code <= 90) code += 32;
    if (code !== expectedLowercase.charCodeAt(index)) return false;
  }
  return true;
}

function isTrailersOnly(value: string): boolean {
  const members = value.split(",");
  if (members.length === 0) return false;
  for (const member of members) {
    let start = 0;
    let end = member.length;
    while (start < end && (member.charCodeAt(start) === 32 || member.charCodeAt(start) === 9)) {
      start++;
    }
    while (end > start && (member.charCodeAt(end - 1) === 32 || member.charCodeAt(end - 1) === 9)) {
      end--;
    }
    const trimmed = member.slice(start, end);
    if (trimmed === "" || !asciiEqualsIgnoreCase(trimmed, "trailers")) return false;
  }
  return true;
}

function validateField(field: HpackHeaderField, streamId: number): void {
  if (!isLowercaseFieldName(field.name)) {
    streamProtocolError("HTTP/2 field name is empty, uppercase, or not a token", streamId);
  }
  if (
    field.value.startsWith(" ") ||
    field.value.startsWith("\t") ||
    field.value.endsWith(" ") ||
    field.value.endsWith("\t")
  ) {
    streamProtocolError("HTTP/2 field value contains forbidden whitespace or controls", streamId);
  }
  for (const forbidden of forbiddenConnectionFields) {
    if (field.name === forbidden) {
      streamProtocolError("HTTP/2 message contains a connection-specific field", streamId);
    }
  }
  for (let index = 0; index < field.value.length; index++) {
    const code = field.value.charCodeAt(index);
    if ((code < 32 && code !== 9) || code === 127) {
      streamProtocolError("HTTP/2 field value contains a forbidden control", streamId);
    }
  }
  if (field.name === "te" && !isTrailersOnly(field.value)) {
    streamProtocolError("HTTP/2 TE field contains a value other than trailers", streamId);
  }
}

function parseContentLength(fields: readonly HpackHeaderField[], streamId: number): number | null {
  let expected: number | null = null;
  let sawValue = false;
  for (const field of fields) {
    if (field.name !== "content-length") continue;
    const values = field.value.split(",");
    for (const value of values) {
      if (value === "" || !/^[0-9]+$/.test(value)) {
        streamProtocolError("HTTP/2 Content-Length is invalid", streamId);
      }
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed)) {
        streamProtocolError("HTTP/2 Content-Length exceeds the exact integer range", streamId);
      }
      if (!sawValue) {
        expected = parsed;
        sawValue = true;
      } else if (parsed !== expected) {
        streamProtocolError("HTTP/2 Content-Length fields disagree", streamId);
      }
    }
  }
  return expected;
}

export function validateHttp2RequestHeaders(
  fields: readonly HpackHeaderField[],
  streamId: number,
  extendedConnectEnabled: boolean,
): number | null {
  let regular = false;
  let method: string | null = null;
  let scheme: string | null = null;
  let authority: string | null = null;
  let path: string | null = null;
  let protocol: string | null = null;
  for (const field of fields) {
    validateField(field, streamId);
    const pseudo = field.name.startsWith(":");
    if (pseudo && regular)
      streamProtocolError("HTTP/2 pseudo-header followed a regular field", streamId);
    if (!pseudo) regular = true;

    switch (field.name) {
      case ":method":
        if (method !== null) streamProtocolError("Duplicate HTTP/2 :method", streamId);
        method = field.value;
        break;
      case ":scheme":
        if (scheme !== null) streamProtocolError("Duplicate HTTP/2 :scheme", streamId);
        scheme = field.value;
        break;
      case ":authority":
        if (authority !== null) streamProtocolError("Duplicate HTTP/2 :authority", streamId);
        authority = field.value;
        break;
      case ":path":
        if (path !== null) streamProtocolError("Duplicate HTTP/2 :path", streamId);
        path = field.value;
        break;
      case ":protocol":
        if (protocol !== null) streamProtocolError("Duplicate HTTP/2 :protocol", streamId);
        protocol = field.value;
        break;
      default:
        if (pseudo) streamProtocolError("Unknown HTTP/2 request pseudo-header", streamId);
    }
  }
  const contentLength = parseContentLength(fields, streamId);

  if (method === null || method === "")
    streamProtocolError("HTTP/2 request omitted :method", streamId);
  if (protocol !== null) {
    if (!extendedConnectEnabled || method !== "CONNECT") {
      streamProtocolError("HTTP/2 extended CONNECT was not enabled", streamId);
    }
    if (protocol === "" || scheme === null || authority === null || path === null || path === "") {
      streamProtocolError("HTTP/2 extended CONNECT omitted a required pseudo-header", streamId);
    }
    return contentLength;
  }
  if (method === "CONNECT") {
    if (authority === null || authority === "" || scheme !== null || path !== null) {
      streamProtocolError("HTTP/2 CONNECT has invalid pseudo-headers", streamId);
    }
    return contentLength;
  }
  if (
    scheme === null ||
    scheme === "" ||
    authority === null ||
    authority === "" ||
    path === null ||
    path === ""
  ) {
    streamProtocolError("HTTP/2 request omitted a required pseudo-header", streamId);
  }
  return contentLength;
}

export function parseHttp2ResponseHeaders(
  fields: readonly DecodedHpackHeaderField[],
  streamId: number,
): Http2ResponseHeaders {
  let regular = false;
  let statusText: string | null = null;
  const headers: DecodedHpackHeaderField[] = [];
  for (const field of fields) {
    validateField(field, streamId);
    const pseudo = field.name.startsWith(":");
    if (pseudo && regular)
      streamProtocolError("HTTP/2 pseudo-header followed a regular field", streamId);
    if (!pseudo) regular = true;
    if (field.name === ":status") {
      if (statusText !== null) streamProtocolError("Duplicate HTTP/2 :status", streamId);
      statusText = field.value;
    } else if (pseudo) {
      streamProtocolError("Unknown HTTP/2 response pseudo-header", streamId);
    } else {
      headers.push(field);
    }
  }
  if (statusText === null || !/^[1-5][0-9][0-9]$/.test(statusText) || statusText === "101") {
    streamProtocolError("HTTP/2 response has an invalid :status", streamId);
  }
  return {
    status: Number(statusText),
    headers,
    contentLength: parseContentLength(headers, streamId),
  };
}

export function parseHttp2Trailers(
  fields: readonly DecodedHpackHeaderField[],
  streamId: number,
): readonly DecodedHpackHeaderField[] {
  for (const field of fields) {
    validateField(field, streamId);
    if (field.name.startsWith(":")) {
      streamProtocolError("HTTP/2 trailer block contains a pseudo-header", streamId);
    }
    if (field.name === "content-length" || field.name === "host" || field.name === "te") {
      streamProtocolError("HTTP/2 trailer block contains a framing or routing field", streamId);
    }
  }
  return fields;
}

export function http2HeaderListSize(fields: readonly HpackHeaderField[]): number {
  let total = 0;
  for (const field of fields) {
    total += field.name.length + field.value.length + 32;
    if (!Number.isSafeInteger(total)) throw new RangeError("HTTP/2 header list size is not exact");
  }
  return total;
}
