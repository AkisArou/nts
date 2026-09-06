import type { RandomSource } from "../provider/primitives.ts";
import { utf8 } from "../core/encoding.ts";
import { Blob } from "../file/blob.ts";
import { FormData } from "./form-data.ts";

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

  for (const byte of entropy) boundary += byte.toString(16).padStart(2, "0");
  const parts: (string | Blob | Uint8Array)[] = [];

  for (const [name, value] of form) {
    let header =
      "--" + boundary + '\r\nContent-Disposition: form-data; name="' + quoted(name) + '"';
    if (typeof value === "string") {
      header += "\r\n\r\n";
      parts.push(utf8.encode(header), utf8.encode(newlines(value)), "\r\n");
    } else {
      header +=
        '; filename="' +
        quoted(value.name) +
        '"\r\nContent-Type: ' +
        (value.type || "application/octet-stream") +
        "\r\n\r\n";
      parts.push(utf8.encode(header), value, "\r\n");
    }
  }

  parts.push("--" + boundary + "--\r\n");
  const contentType = "multipart/form-data; boundary=" + boundary;
  return { blob: new Blob(parts, { type: contentType }), contentType };
}
