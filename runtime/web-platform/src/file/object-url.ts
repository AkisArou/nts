import type { RandomSource, URLRecord } from "../provider/primitives.ts";
import { Blob } from "./blob.ts";

const UUID_BYTES = 16;
const MAX_UUID_ATTEMPTS = 16;
const HEX = "0123456789abcdef";

/**
 * The File API's Blob URL store for one NTS environment.
 *
 * Entries hold the Blob itself, not a materialized byte copy. That preserves
 * reopenable provider storage and keeps the object alive until revocation or
 * environment teardown. A Request captures the resolved Blob when its URL is
 * parsed, so later revocation cannot invalidate an already-started fetch.
 */
export class BlobURLStore {
  private readonly entries = new Map<string, Blob>();
  private readonly random: RandomSource;
  private readonly prefix: string;

  constructor(random: RandomSource, origin: string | undefined, prefix: string | undefined) {
    this.random = random;
    this.prefix = prefix ?? `blob:${origin ?? "null"}/`;
    if (!this.prefix.startsWith("blob:") || this.prefix.length === 5) {
      throw new TypeError("Invalid Blob URL prefix");
    }
  }

  create(blob: Blob): string {
    if (!(blob instanceof Blob)) {
      throw new TypeError("Object URL source must be a Blob");
    }

    for (let attempt = 0; attempt < MAX_UUID_ATTEMPTS; attempt++) {
      const url = this.prefix + generateUUID(this.random);
      if (!this.entries.has(url)) {
        this.entries.set(url, blob);
        return url;
      }
    }
    throw new Error("Random source repeatedly generated an existing Blob URL");
  }

  /** Resolve using URL serialization with its fragment excluded. */
  resolve(url: URLRecord): Blob | null {
    if (url.protocol !== "blob:") {
      return null;
    }
    const fragment = url.href.indexOf("#");
    const key = fragment < 0 ? url.href : url.href.slice(0, fragment);
    return this.entries.get(key) ?? null;
  }

  /** Revoke using the exact parsed serialization; fragments are significant here. */
  revoke(url: URLRecord): void {
    if (url.protocol === "blob:") {
      this.entries.delete(url.href);
    }
  }

  close(): void {
    this.entries.clear();
  }
}

function generateUUID(random: RandomSource): string {
  const bytes = new Uint8Array(UUID_BYTES);
  random.fill(bytes);
  const version = bytes[6];
  const variant = bytes[8];
  if (version === undefined || variant === undefined) {
    throw new Error("Random source did not fill a UUID buffer");
  }
  bytes[6] = (version & 0x0f) | 0x40;
  bytes[8] = (variant & 0x3f) | 0x80;

  let result = "";
  for (let index = 0; index < bytes.length; index++) {
    if (index === 4 || index === 6 || index === 8 || index === 10) {
      result += "-";
    }
    const byte = bytes[index];
    if (byte === undefined) {
      throw new Error("Random source did not fill a UUID buffer");
    }
    result += HEX.charAt(byte >>> 4) + HEX.charAt(byte & 0x0f);
  }
  return result;
}
