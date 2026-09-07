import type { AbortSignal } from "../core/abort.ts";
import type { BlobExternalSource } from "../file/blob.ts";
import type { URLRecord } from "../provider/primitives.ts";

/**
 * What a provider returns for a `file:` URL it is willing to serve.
 *
 * The media type is the provider's decision, because deciding it needs knowledge this
 * layer does not have. An empty string means unknown, exactly as for a Blob.
 */
export interface FileURLEntry {
  readonly source: BlobExternalSource;
  readonly type: string;
}

/**
 * Capability-scoped filesystem access for `file:` URLs.
 *
 * Absent by default: without one, `file:` fails exactly like any other unsupported
 * scheme, so enabling local file reads is always a deliberate act. The provider owns
 * URL-to-path mapping and the scope it will serve, because both are platform policy —
 * path grammar differs per operating system, and which directories an application may
 * read is not something shared networking code can know. This layer owns the parts
 * that are the same everywhere: which URLs are fetchable at all, which methods apply,
 * and the shape of the response.
 */
export interface FileURLProvider {
  open(url: URLRecord, signal: AbortSignal): Promise<FileURLEntry>;
}

/**
 * Rejects `file:` URLs that are not fetchable, before any provider sees them.
 *
 * A host is permitted only when it is empty or `localhost`, which the URL parser
 * already normalizes away; anything else names a remote machine and is refused here
 * rather than being handed to a filesystem. Credentials are meaningless for a file and
 * are refused rather than ignored.
 */
export function validateFileURL(url: URLRecord): void {
  if (url.username !== "" || url.password !== "") {
    throw new TypeError("Credentials in file URLs are not permitted");
  }
  if (url.hostname !== "" && url.hostname !== "localhost") {
    throw new TypeError("A file URL with a remote host cannot be fetched");
  }
  if (url.port !== "") throw new TypeError("A file URL cannot carry a port");
}

/** Methods a `file:` URL answers. Anything else fails deterministically. */
export function fileURLMethodAllowed(method: string): boolean {
  return method === "GET" || method === "HEAD";
}
