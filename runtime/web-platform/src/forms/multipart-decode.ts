import { asciiBytes, decodeUTF8 } from "../core/encoding.ts";
import { LimitError } from "../core/errors.ts";
import { isToken } from "../fetch/headers.ts";
import { FormData } from "./form-data.ts";
import { File } from "./blob.ts";
import { parseParameterized } from "./mime.ts";
export interface MultipartDecodeLimits {
  maxParts?: number;
  maxPartHeaderBytes?: number;
}
/** KMP search avoids quadratic behavior on adversarial repeated boundary prefixes. */
class BytePattern {
  private readonly needle: Uint8Array;
  private readonly prefix: number[];
  constructor(needle: Uint8Array) {
    this.needle = needle;
    this.prefix = new Array<number>(needle.length).fill(0);
    for (let i = 1, matched = 0; i < needle.length; i++) {
      while (matched > 0 && needle[i] !== needle[matched]) matched = this.prefix[matched - 1] ?? 0;
      if (needle[i] === needle[matched]) matched++;
      this.prefix[i] = matched;
    }
  }
  find(bytes: Uint8Array, from: number): number {
    for (let i = from, matched = 0; i < bytes.length; i++) {
      while (matched > 0 && bytes[i] !== this.needle[matched])
        matched = this.prefix[matched - 1] ?? 0;
      if (bytes[i] === this.needle[matched]) matched++;
      if (matched === this.needle.length) return i - matched + 1;
    }
    return -1;
  }
}
function at(bytes: Uint8Array, position: number, a: number, b: number): boolean {
  return bytes[position] === a && bytes[position + 1] === b;
}
/** Materializing Body.formData() parser, not an implicit network buffer. */
export function decodeMultipart(
  bytes: Uint8Array,
  contentType: string,
  limits: MultipartDecodeLimits = {},
): FormData {
  const mime = parseParameterized(contentType);
  const boundary = mime.parameters.get("boundary");
  if (
    mime.value !== "multipart/form-data" ||
    boundary === undefined ||
    boundary.length < 1 ||
    boundary.length > 70 ||
    !/^[0-9A-Za-z'()+_,\-./:=? ]+$/.test(boundary) ||
    boundary.endsWith(" ")
  )
    throw new TypeError("Invalid multipart boundary");
  const opening = asciiBytes("--" + boundary);
  const marker = asciiBytes("\r\n--" + boundary);
  const search = new BytePattern(marker);
  const headersEnd = new BytePattern(Uint8Array.of(13, 10, 13, 10));
  let offset = 0;
  if (!opening.every((byte, index) => bytes[index] === byte)) {
    // MIME permits a preamble. Only a boundary at a line boundary is recognized.
    const first = search.find(bytes, 0);
    if (first < 0) throw new TypeError("Missing multipart opening boundary");
    offset = first + 2;
  }
  offset += opening.length;
  const result = new FormData();
  let parts = 0;
  while (true) {
    if (at(bytes, offset, 45, 45)) {
      if (offset + 2 !== bytes.length && !at(bytes, offset + 2, 13, 10))
        throw new TypeError("Malformed multipart closing boundary");
      return result; // An optional CRLF and arbitrary MIME epilogue are ignored.
    }
    if (!at(bytes, offset, 13, 10)) throw new TypeError("Malformed multipart boundary separator");
    offset += 2;
    if (++parts > (limits.maxParts ?? 10000)) throw new LimitError("Too many multipart fields");
    const end = headersEnd.find(bytes, offset);
    if (end < 0 || end - offset > (limits.maxPartHeaderBytes ?? 16384))
      throw new LimitError("Multipart headers missing or too large");
    let disposition: string | null = null;
    let type = "application/octet-stream";
    for (const line of decodeUTF8(bytes.subarray(offset, end)).split("\r\n")) {
      const colon = line.indexOf(":");
      const name = line.slice(0, colon).toLowerCase();
      const value = line.slice(colon + 1).trim();
      if (colon < 1 || !isToken(name) || /[\r\n\0]/.test(value))
        throw new TypeError("Malformed multipart part header");
      if (name === "content-disposition") {
        if (disposition !== null) throw new TypeError("Duplicate Content-Disposition");
        disposition = value;
      } else if (name === "content-type") type = value;
      else if (
        name === "content-transfer-encoding" &&
        value.toLowerCase() !== "binary" &&
        value.toLowerCase() !== "8bit"
      ) {
        throw new TypeError("Encoded multipart parts are not supported");
      }
    }
    if (disposition === null) throw new TypeError("Missing multipart Content-Disposition");
    const parameters = parseParameterized(disposition);
    const name = parameters.parameters.get("name");
    if (parameters.value !== "form-data" || name === undefined)
      throw new TypeError("Invalid multipart disposition");
    const bodyStart = end + 4;
    let next = search.find(bytes, bodyStart);
    while (next >= 0) {
      const suffix = next + marker.length;
      if (
        at(bytes, suffix, 13, 10) ||
        (at(bytes, suffix, 45, 45) &&
          (suffix + 2 === bytes.length || at(bytes, suffix + 2, 13, 10)))
      )
        break;
      next = search.find(bytes, next + marker.length);
    }
    if (next < 0) throw new TypeError("Missing multipart closing boundary");
    const data = bytes.subarray(bodyStart, next);
    const filename = parameters.parameters.get("filename");
    if (filename === undefined) result.append(name, decodeUTF8(data));
    else result.append(name, new File([data], filename, { type }));
    offset = next + marker.length;
  }
}
