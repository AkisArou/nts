import { forgivingBase64Decode } from "../core/base64.ts";
import { percentDecodeBytes } from "../core/percent.ts";
import { trimASCIIWhitespace } from "../core/ascii.ts";
import { parseMIMEType, serializeMIMEType } from "../forms/mime.ts";
import type { URLRecord } from "../provider/primitives.ts";

export interface DataURLResult {
  readonly body: Uint8Array;
  readonly mimeType: string;
}

function withoutFragment(url: URLRecord): string {
  return url.hash === "" ? url.href : url.href.slice(0, url.href.length - url.hash.length);
}

function removeBase64Marker(input: string): string | null {
  if (input.length < 7 || input.slice(input.length - 6).toLowerCase() !== "base64") return null;
  let semicolon = input.length - 7;
  while (semicolon >= 0 && input.charCodeAt(semicolon) === 0x20) semicolon--;
  if (input.charAt(semicolon) !== ";") return null;
  let end = semicolon;
  while (end > 0 && input.charCodeAt(end - 1) === 0x20) end--;
  return input.slice(0, end);
}

/** The Fetch Standard's data: URL processor. */
export function processDataURL(url: URLRecord): DataURLResult | null {
  const serialized = withoutFragment(url);
  if (url.protocol !== "data:" || !serialized.startsWith("data:")) return null;
  const input = serialized.slice(5);
  const comma = input.indexOf(",");
  if (comma < 0) return null;

  let mimeType = trimASCIIWhitespace(input.slice(0, comma));
  let body = percentDecodeBytes(input.slice(comma + 1));
  const withoutBase64 = removeBase64Marker(mimeType);
  if (withoutBase64 !== null) {
    const decoded = forgivingBase64Decode(body);
    if (decoded === null) return null;
    body = decoded;
    mimeType = withoutBase64;
  }

  if (mimeType.startsWith(";")) mimeType = "text/plain" + mimeType;
  const parsed = parseMIMEType(mimeType);
  return {
    body,
    mimeType: parsed === null ? "text/plain;charset=US-ASCII" : serializeMIMEType(parsed),
  };
}
