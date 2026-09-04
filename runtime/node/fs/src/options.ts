// `getOptions`, node `lib/internal/fs/utils.js`.
//
// Every `fs` function that can produce text takes `(path[, options])` where
// options is a string encoding, an object with `encoding` and `flag`, or
// nothing. Getting this shape right is most of matching node's surface: a
// function that insists on a string rejects `readFileSync(p, { encoding })`,
// which is how half of node's own tests call it.

import {
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_OUT_OF_RANGE,
} from "../../internal/errors.ts";
import {
  validateAbortSignal,
  validateBoolean,
  validateInteger,
  validateObject,
  validateUint32,
} from "../../internal/validators.ts";
import {
  isEncoding,
  normalizeEncoding,
  type Encoding,
} from "../../buffer/src/encodings.ts";
import { Buffer } from "../../buffer/src/main.ts";
import { fileURLToPath } from "../../url/src/fileurl.ts";
import { URL } from "../../url/src/url.ts";
import { emitWarning } from "../../internal/process-warning.ts";

/** Whether the active binding layer already emits mkdtemp's public warning. */
declare function nts_fs_binding_warns_on_mkdtemp(): boolean;

export interface FileOptions {
  encoding?: string | null;
  flag?: string | number;
  mode?: number | string;
  signal?: AbortSignalLike;
  flush?: boolean;
}

/** Options shared by the callback, promise, and synchronous `rm` forms. */
export interface RmOptions {
  force?: boolean;
  maxRetries?: number;
  recursive?: boolean;
  retryDelay?: number;
}

/** Options shared by the callback, promise, and synchronous `rmdir` forms. */
export interface RmdirOptions {
  maxRetries?: number;
  recursive?: boolean;
  retryDelay?: number;
}

/** Fully validated removal settings used by the filesystem algorithms. */
export interface NormalizedRmOptions {
  readonly force: boolean;
  readonly maxRetries: number;
  readonly recursive: boolean;
  readonly retryDelay: number;
}

/** Fully validated legacy-directory-removal settings. */
export interface NormalizedRmdirOptions {
  readonly maxRetries: number;
  readonly recursive: boolean;
  readonly retryDelay: number;
}

/** Property-readable shape used only while validating an untrusted options object. */
interface RawRemovalOptions {
  readonly force?: unknown;
  readonly maxRetries?: unknown;
  readonly recursive?: unknown;
  readonly retryDelay?: unknown;
}

function validateRemovalOptionsObject(
  options: unknown,
): asserts options is RawRemovalOptions {
  validateObject(options, "options");
}

/** Encodings accepted by filesystem APIs whose result can be bytes. */
export type FileResultEncoding = Encoding | "buffer";

/** A filesystem name returned either as decoded text or as bytes. */
export type EncodedFileName = string | Buffer;

/** The fixed surface `readFile` needs from a DOM or Node abort signal. */
export interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason?: unknown;
}

/** Path spellings that this profile can preserve across its native ABI. */
export type PathLike = string | URL;

/** Path spellings accepted by byte-aware filesystem bindings. */
export type BytePathLike = PathLike | Uint8Array;

/** A validated text path, or the exact bytes supplied by the caller. */
export type ValidatedBytePath = string | number[];

/** The only link kinds accepted by Node's symlink family. */
export type SymlinkType = "dir" | "file" | "junction" | null | undefined;

/** Node treats every signed 32-bit integer as a caller-owned descriptor. */
export function isFileDescriptor(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) &&
    value >= -2_147_483_648 && value <= 2_147_483_647;
}

export function getValidatedPath(path: PathLike, name?: string): string;
export function getValidatedPath(path: unknown, name?: string): string;
export function getValidatedPath(path: unknown, name = "path"): string {
  let value: string;
  if (typeof path === "string") {
    value = path;
  } else if (path instanceof URL) {
    value = fileURLToPath(path);
  } else {
    throw new ERR_INVALID_ARG_TYPE(name, ["string", "Buffer", "URL"], path);
  }
  if (value.includes("\0")) {
    throw new ERR_INVALID_ARG_VALUE(
      name,
      path,
      "must be a string, Uint8Array, or URL without null bytes",
    );
  }
  return value;
}

/**
 * Validate a path without decoding caller-supplied bytes.
 *
 * POSIX permits every non-NUL byte in a filename. Converting a Buffer through
 * UTF-8 would therefore change which file an operation addresses. Byte-aware
 * native bindings use this representation and pass it directly to libuv.
 */
export function getValidatedBytePath(
  path: BytePathLike,
  name?: string,
): ValidatedBytePath;
export function getValidatedBytePath(
  path: unknown,
  name?: string,
): ValidatedBytePath;
export function getValidatedBytePath(
  path: unknown,
  name = "path",
): ValidatedBytePath {
  if (!(path instanceof Uint8Array)) return getValidatedPath(path, name);

  const bytes = new Array<number>(path.byteLength);
  for (let i = 0; i < path.byteLength; i++) {
    const byte = path[i];
    if (byte === undefined) {
      throw new Error(`filesystem path is missing byte ${i}`);
    }
    if (byte === 0) {
      throw new ERR_INVALID_ARG_VALUE(
        name,
        path,
        "must be a string, Uint8Array, or URL without null bytes",
      );
    }
    bytes[i] = byte;
  }
  return bytes;
}

export function validateFileDescriptor(fd: unknown): asserts fd is number {
  validateInteger(fd, "fd", 0, 2_147_483_647);
}

export function validateOwnerId(value: unknown, name: "uid" | "gid"): asserts value is number {
  validateInteger(value, name, -1, 4_294_967_295);
}

export function validateAccessMode(mode: unknown): number {
  if (mode === null || mode === undefined) return 0;
  if (typeof mode !== "number") {
    throw new ERR_INVALID_ARG_TYPE("mode", "int32 or null/undefined", mode);
  }
  if (!Number.isFinite(mode) || mode < 0 || mode > 7) {
    throw new ERR_OUT_OF_RANGE("mode", ">= 0 && <= 7", mode);
  }
  return mode | 0;
}

/** Convert the three timestamp spellings accepted by Node to UNIX seconds. */
export function toUnixTimestamp(
  time: number | string | Date,
  name = "time",
): number {
  if (typeof time === "string") {
    const numeric = Number(time);
    if (!Number.isNaN(numeric)) return numeric;
  }
  if (typeof time === "number" && Number.isFinite(time)) {
    return time < 0 ? Date.now() / 1000 : time;
  }
  if (time instanceof Date) return time.getTime() / 1000;
  throw new ERR_INVALID_ARG_TYPE(name, ["Date", "Time in seconds"], time);
}

export function getOptions(
  options: string | FileOptions | null | undefined,
  defaults: FileOptions = {},
): FileOptions {
  if (options === null || options === undefined || typeof options === "function") {
    return defaults;
  }
  let result: FileOptions;
  if (typeof options === "string") {
    result = { ...defaults, encoding: options };
  } else if (typeof options !== "object") {
    throw new ERR_INVALID_ARG_TYPE("options", ["string", "Object"], options);
  } else {
    result = { ...defaults, ...options };
  }
  validateEncodingOption(result.encoding);
  validateAbortSignal(result.signal, "options.signal");
  return result;
}

/** Node's shared `assertEncoding`, used before any filesystem work begins. */
export function validateEncodingOption(encoding: unknown): void {
  if (encoding !== "buffer" && encoding && !isEncoding(encoding)) {
    throw new ERR_INVALID_ARG_VALUE("encoding", encoding, "is invalid encoding");
  }
}

/** Validate and canonicalize an encoding used for a filesystem result. */
export function normalizeFileResultEncoding(
  encoding: unknown,
): FileResultEncoding | undefined {
  validateEncodingOption(encoding);
  if (!encoding) return undefined;
  if (encoding === "buffer") return encoding;

  const normalized = normalizeEncoding(encoding);
  if (normalized === undefined) {
    throw new ERR_INVALID_ARG_VALUE("encoding", encoding, "is invalid encoding");
  }
  return normalized;
}

/**
 * Encode a path-like result using the same rule as Node's fs bindings.
 *
 * The native operations in this profile return their ordinary UTF-8 result as
 * text. Encoding that text back to UTF-8 bytes before applying the requested
 * decoder is exactly Node's `encodeRealpathResult` behavior and also preserves
 * the `"buffer"` result contract for representable filesystem names.
 */
export function encodeFileName(
  value: string,
  encoding: string | null | undefined,
): EncodedFileName {
  validateEncodingOption(encoding);
  if (!encoding || encoding === "utf8" || encoding === "utf-8") return value;

  const bytes = Buffer.from(value);
  if (encoding === "buffer") return bytes;

  const normalized = normalizeEncoding(encoding);
  if (normalized === undefined) {
    // `validateEncodingOption` already rejects this branch. Keeping the guard
    // local makes the narrowing explicit and protects this helper if the
    // validation rule is changed independently later.
    throw new ERR_INVALID_ARG_VALUE("encoding", encoding, "is invalid encoding");
  }
  return bytes.toString(normalized);
}

/** Decode exact filesystem bytes using the caller's requested result form. */
export function encodeFileBytes(
  value: number[],
  encoding: string | null | undefined,
): EncodedFileName {
  return encodeNormalizedFileBytes(value, normalizeFileResultEncoding(encoding));
}

/** Encode exact bytes after an API has validated its result encoding once. */
export function encodeNormalizedFileBytes(
  value: number[],
  encoding: FileResultEncoding | undefined,
): EncodedFileName {
  const bytes = Buffer.from(value);
  if (encoding === "buffer") return bytes;
  return bytes.toString(encoding);
}

/** Convert a validated text path to UTF-8 only when a byte binding needs it. */
export function bytePathForBinding(path: ValidatedBytePath): number[] {
  if (typeof path !== "string") return path;
  const encoded = Buffer.from(path);
  const bytes = new Array<number>(encoded.length);
  for (let i = 0; i < encoded.length; i++) {
    const byte = encoded[i];
    if (byte === undefined) {
      throw new Error(`encoded filesystem path is missing byte ${i}`);
    }
    bytes[i] = byte;
  }
  return bytes;
}

/** Human-readable path field for an error returned from a byte binding. */
export function displayBytePath(path: ValidatedBytePath): string {
  return typeof path === "string" ? path : Buffer.from(path).toString();
}

/** Validate a public symlink type and return libuv's corresponding flag. */
export function symlinkTypeFlags(type: unknown): 0 | 1 | 2 {
  switch (type) {
    case undefined:
    case null:
    case "file":
      return 0;
    case "dir":
      return 1;
    case "junction":
      return 2;
    default:
      throw new ERR_INVALID_ARG_VALUE(
        "type",
        type,
        "must be one of: 'dir', 'file', 'junction', null, undefined",
      );
  }
}

/** Validate `rm` options once before traversal begins. */
export function normalizeRmOptions(options: unknown): NormalizedRmOptions {
  if (options === undefined) {
    return { force: false, maxRetries: 0, recursive: false, retryDelay: 100 };
  }
  validateRemovalOptionsObject(options);

  const force = options.force ?? false;
  const maxRetries = options.maxRetries ?? 0;
  const recursive = options.recursive ?? false;
  const retryDelay = options.retryDelay ?? 100;
  validateBoolean(force, "options.force");
  validateUint32(maxRetries, "options.maxRetries");
  validateBoolean(recursive, "options.recursive");
  validateInteger(retryDelay, "options.retryDelay", 0, 2_147_483_647);
  return { force, maxRetries, recursive, retryDelay };
}

/** Validate legacy `rmdir` options without admitting `rm`'s `force` flag. */
export function normalizeRmdirOptions(options: unknown): NormalizedRmdirOptions {
  if (options === undefined) {
    return { maxRetries: 0, recursive: false, retryDelay: 100 };
  }
  validateRemovalOptionsObject(options);

  const maxRetries = options.maxRetries ?? 0;
  const recursive = options.recursive ?? false;
  const retryDelay = options.retryDelay ?? 100;
  validateUint32(maxRetries, "options.maxRetries");
  validateBoolean(recursive, "options.recursive");
  validateInteger(retryDelay, "options.retryDelay", 0, 2_147_483_647);
  return { maxRetries, recursive, retryDelay };
}

let recursiveRmdirWarningEmitted = false;

/** Emit the process-wide deprecation warning owned by recursive `rmdir`. */
export function emitRecursiveRmdirWarning(): void {
  if (recursiveRmdirWarningEmitted) return;
  recursiveRmdirWarningEmitted = true;
  emitWarning(
    "In future versions of Node.js, fs.rmdir(path, { recursive: true }) " +
      "will be removed. Use fs.rm(path, { recursive: true }) instead",
    "DeprecationWarning",
    "DEP0147",
  );
}

/** Append the six placeholders required by `uv_fs_mkdtemp`. */
export function appendMkdtempSuffix(prefix: number[]): number[] {
  const template = new Array<number>(prefix.length + 6);
  for (let i = 0; i < prefix.length; i++) {
    const byte = prefix[i];
    if (byte === undefined) {
      throw new Error(`filesystem path is missing byte ${i}`);
    }
    template[i] = byte;
  }
  for (let i = prefix.length; i < template.length; i++) template[i] = 0x58;
  return template;
}

let warnAboutNonPortableTemplate = true;

/** Warn once when a `mkdtemp` prefix ends in the non-portable `X` form. */
export function warnOnNonPortableTemplate(template: string | number[]): void {
  if (!warnAboutNonPortableTemplate) return;
  const endsWithX = typeof template === "string"
    ? template.endsWith("X")
    : template.length > 0 && template[template.length - 1] === 0x58;
  if (!endsWithX) return;
  warnAboutNonPortableTemplate = false;
  // The TypeScript-on-Node stand-in delegates to Node's public `fs.mkdtemp`,
  // which owns this warning already. The compiled binding calls libuv
  // directly, so the TypeScript layer owns it there.
  if (nts_fs_binding_warns_on_mkdtemp()) return;
  emitWarning(
    "mkdtemp() templates ending with X are not portable. " +
      "For details see: https://nodejs.org/api/fs.html",
    "Warning",
    "",
  );
}

/**
 * The encoding, checked.
 *
 * `null` means "give me the bytes", which node answers with a `Buffer`. There
 * is no `node:buffer` yet, so that request is refused with the reason rather
 * than answered with a string that would silently differ.
 */
export function requireTextEncoding(
  encoding: string | null | undefined,
  name: string,
): Encoding {
  if (encoding === null || encoding === undefined) {
    throw new ERR_INVALID_ARG_TYPE(
      name,
      "string",
      encoding,
    );
  }
  const normalized = normalizeEncoding(encoding);
  if (normalized === undefined) {
    throw new ERR_INVALID_ARG_VALUE("encoding", encoding, "is invalid encoding");
  }
  return normalized;
}
