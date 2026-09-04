// `getOptions`, node `lib/internal/fs/utils.js`.
//
// Every `fs` function that can produce text takes `(path[, options])` where
// options is a string encoding, an object with `encoding` and `flag`, or
// nothing. Getting this shape right is most of matching node's surface: a
// function that insists on a string rejects `readFileSync(p, { encoding })`,
// which is how half of node's own tests call it.

import { ERR_INVALID_ARG_TYPE } from "../../internal/errors.ts";

export interface FileOptions {
  encoding?: string | null;
  flag?: string;
  mode?: number;
}

/** The encodings a `Buffer`-free implementation can produce. */
const KNOWN_ENCODINGS = ["utf8", "utf-8"];

export function getOptions(
  options: string | FileOptions | null | undefined,
  defaults: FileOptions = {},
): FileOptions {
  if (options === null || options === undefined || typeof options === "function") {
    return defaults;
  }
  if (typeof options === "string") {
    return { ...defaults, encoding: options };
  }
  if (typeof options !== "object") {
    throw new ERR_INVALID_ARG_TYPE("options", "string", options);
  }
  return { ...defaults, ...options };
}

/**
 * The encoding, checked.
 *
 * `null` means "give me the bytes", which node answers with a `Buffer`. There
 * is no `node:buffer` yet, so that request is refused with the reason rather
 * than answered with a string that would silently differ.
 */
export function requireTextEncoding(encoding: string | null | undefined, name: string): string {
  if (encoding === null || encoding === undefined) {
    throw new ERR_INVALID_ARG_TYPE(
      name,
      "string",
      encoding,
    );
  }
  const normalized = encoding.toLowerCase();
  if (!KNOWN_ENCODINGS.includes(normalized)) {
    throw new ERR_INVALID_ARG_TYPE(name, "string", encoding);
  }
  return normalized;
}
