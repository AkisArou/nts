// Shared `readdir` result assembly for the synchronous and callback surfaces.

import { ERR_INVALID_ARG_TYPE } from "../../internal/errors.ts";
import { Dirent } from "./stats.ts";
import {
  encodeNormalizedFileBytes,
  normalizeFileResultEncoding,
  type EncodedFileName,
  type FileResultEncoding,
} from "./options.ts";

export interface ReaddirOptions {
  encoding?: FileResultEncoding | null;
  withFileTypes?: boolean;
}

export type ReaddirResult = EncodedFileName[] | Dirent<EncodedFileName>[];

export function normalizeReaddirOptions(
  options: string | ReaddirOptions | null | undefined,
): ReaddirOptions {
  if (options === null || options === undefined) return {};
  if (typeof options === "string") {
    return { encoding: normalizeFileResultEncoding(options) };
  }
  if (typeof options !== "object") {
    throw new ERR_INVALID_ARG_TYPE("options", ["string", "Object"], options);
  }
  return {
    encoding: normalizeFileResultEncoding(options.encoding),
    withFileTypes: Boolean(options.withFileTypes),
  };
}

/**
 * Decode rows returned by the native scandir seam.
 *
 * A row is `[uv_dirent_type_t, ...nameBytes]`. Keeping the name as bytes until
 * this point preserves POSIX filenames that are not UTF-8 and lets every
 * supported output encoding observe the exact directory entry.
 */
export function decodeScandirRows(
  rows: number[][],
  parentPath: string,
  options: ReaddirOptions & { withFileTypes: true },
): Dirent<EncodedFileName>[];
export function decodeScandirRows(
  rows: number[][],
  parentPath: string,
  options: ReaddirOptions & { withFileTypes?: false },
): EncodedFileName[];
export function decodeScandirRows(
  rows: number[][],
  parentPath: string,
  options: ReaddirOptions,
): ReaddirResult;
export function decodeScandirRows(
  rows: number[][],
  parentPath: string,
  options: ReaddirOptions,
): ReaddirResult {
  const names = options.withFileTypes
    ? undefined
    : new Array<EncodedFileName>(rows.length);
  const entries = options.withFileTypes
    ? new Array<Dirent<EncodedFileName>>(rows.length)
    : undefined;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if (row === undefined || row.length === 0) {
      throw new Error(`fs scandir result is missing row ${rowIndex}`);
    }
    const type = row[0];
    if (type === undefined || !Number.isInteger(type) || type < 0 || type > 7) {
      throw new Error(`fs scandir result has invalid type ${rowIndex}`);
    }
    const bytes = new Array<number>(row.length - 1);
    for (let byteIndex = 1; byteIndex < row.length; byteIndex++) {
      const byte = row[byteIndex];
      if (byte === undefined) {
        throw new Error(`fs scandir row ${rowIndex} is missing byte ${byteIndex}`);
      }
      bytes[byteIndex - 1] = byte;
    }
    const name = encodeNormalizedFileBytes(
      bytes,
      options.encoding === null ? undefined : options.encoding,
    );
    if (entries !== undefined) {
      entries[rowIndex] = new Dirent(name, type, parentPath);
    } else if (names !== undefined) {
      names[rowIndex] = name;
    }
  }
  if (entries !== undefined) return entries;
  if (names !== undefined) return names;
  throw new Error("fs scandir result has no destination");
}
