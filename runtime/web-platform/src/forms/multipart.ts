import type { RandomSource } from "../provider/primitives.ts";
import { Blob } from "../file/blob.ts";
import type { BlobPart } from "../file/blob.ts";
import { FormData } from "./form-data.ts";

const HEX_DIGITS = "0123456789abcdef";

export interface EncodedMultipart {
  blob: Blob;
  contentType: string;
}

function newlines(input: string): string {
  return input.replace(/\r\n|\r|\n/g, "\r\n");
}

function quoted(input: string): string {
  return newlines(input).replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/"/g, "%22");
}

/** Blob concatenation shares immutable segments; file contents are NOT eagerly materialized. */
export function encodeMultipart(form: FormData, random: RandomSource): EncodedMultipart {
  const entropy = new Uint8Array(24);

  random.fill(entropy);
  let boundary = "----nts-";

  for (const byte of entropy) {
    boundary += HEX_DIGITS.charAt(byte >>> 4) + HEX_DIGITS.charAt(byte & 15);
  }
  const parts: BlobPart[] = [];

  for (const [name, value] of form) {
    let header =
      "--" + boundary + '\r\nContent-Disposition: form-data; name="' + quoted(name) + '"';
    if (typeof value === "string") {
      header += "\r\n\r\n";
      parts.push(header, newlines(value), "\r\n");
    } else {
      header +=
        '; filename="' +
        quoted(value.name) +
        '"\r\nContent-Type: ' +
        (value.type || "application/octet-stream") +
        "\r\n\r\n";
      parts.push(header, value, "\r\n");
    }
  }

  parts.push("--" + boundary + "--\r\n");
  const contentType = "multipart/form-data; boundary=" + boundary;
  return { blob: new Blob(parts, { type: contentType }), contentType };
}
