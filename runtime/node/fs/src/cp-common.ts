import {
  ERR_INCOMPATIBLE_OPTION_PAIR,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_RETURN_VALUE,
} from "../../internal/errors.ts";
import {
  validateBoolean,
  validateInteger,
  validateObject,
} from "../../internal/validators.ts";
import { resolve as resolvePath } from "../../path/src/posix.ts";

/** A filter accepted by the callback, promise, and synchronous copy forms. */
export type CpFilter = (
  source: string,
  destination: string,
) => boolean | Promise<boolean>;

/** Public fields shared by Node's asynchronous and synchronous copy options. */
interface CopyOptionsBase {
  dereference?: boolean | undefined;
  errorOnExist?: boolean | undefined;
  force?: boolean | undefined;
  mode?: number | undefined;
  preserveTimestamps?: boolean | undefined;
  recursive?: boolean | undefined;
  verbatimSymlinks?: boolean | undefined;
}

export interface CopyOptions extends CopyOptionsBase {
  filter?: CpFilter | undefined;
}

export interface CopySyncOptions extends CopyOptionsBase {
  filter?: ((source: string, destination: string) => boolean) | undefined;
}

/** The validated settings consumed by the copy algorithms. */
export interface NormalizedCpOptions {
  readonly dereference: boolean;
  readonly errorOnExist: boolean;
  readonly filter: CpFilter | undefined;
  readonly force: boolean;
  readonly mode: number;
  readonly preserveTimestamps: boolean;
  readonly recursive: boolean;
  readonly verbatimSymlinks: boolean;
}

interface RawCpOptions {
  readonly dereference?: unknown;
  readonly errorOnExist?: unknown;
  readonly filter?: unknown;
  readonly force?: unknown;
  readonly mode?: unknown;
  readonly preserveTimestamps?: unknown;
  readonly recursive?: unknown;
  readonly verbatimSymlinks?: unknown;
}

function validateRawCpOptions(
  options: unknown,
): asserts options is RawCpOptions {
  validateObject(options, "options");
}

function booleanOption(
  value: unknown,
  name: string,
): boolean {
  validateBoolean(value, name);
  return value;
}

function copyMode(value: unknown): number {
  if (value === undefined || value === null) return 0;
  validateInteger(value, "mode", 0, 7);
  return value;
}

function isCpFilter(value: unknown): value is CpFilter {
  return typeof value === "function";
}

function copyFilter(value: unknown): CpFilter | undefined {
  if (value === undefined) return undefined;
  if (!isCpFilter(value)) {
    throw new ERR_INVALID_ARG_TYPE("options.filter", "Function", value);
  }
  return value;
}

/** Upstream `validateCpOptions`, without mutating or spreading user input. */
export function normalizeCpOptions(options: unknown): NormalizedCpOptions {
  if (options === undefined) {
    return {
      dereference: false,
      errorOnExist: false,
      filter: undefined,
      force: true,
      mode: 0,
      preserveTimestamps: false,
      recursive: false,
      verbatimSymlinks: false,
    };
  }
  validateRawCpOptions(options);
  const dereference = "dereference" in options
    ? booleanOption(options.dereference, "options.dereference")
    : false;
  const verbatimSymlinks = "verbatimSymlinks" in options
    ? booleanOption(options.verbatimSymlinks, "options.verbatimSymlinks")
    : false;
  if (dereference && verbatimSymlinks) {
    throw new ERR_INCOMPATIBLE_OPTION_PAIR("dereference", "verbatimSymlinks");
  }
  return {
    dereference,
    errorOnExist: "errorOnExist" in options
      ? booleanOption(options.errorOnExist, "options.errorOnExist")
      : false,
    filter: copyFilter(options.filter),
    force: "force" in options
      ? booleanOption(options.force, "options.force")
      : true,
    mode: copyMode(options.mode),
    preserveTimestamps: "preserveTimestamps" in options
      ? booleanOption(options.preserveTimestamps, "options.preserveTimestamps")
      : false,
    recursive: "recursive" in options
      ? booleanOption(options.recursive, "options.recursive")
      : false,
    verbatimSymlinks,
  };
}

/** Run a sync filter, rejecting a promise exactly where Node does. */
export function synchronousFilterAllows(
  filter: CpFilter | undefined,
  source: string,
  destination: string,
): boolean {
  if (filter === undefined) return true;
  const result = filter(source, destination);
  if (result instanceof Promise) {
    throw new ERR_INVALID_RETURN_VALUE("boolean", "filter", result);
  }
  return result;
}

/** Path-component containment, with prefix-only siblings kept distinct. */
export function isSrcSubdir(source: string, destination: string): boolean {
  const resolvedSource = resolvePath(source);
  const resolvedDestination = resolvePath(destination);
  if (resolvedSource === resolvedDestination) return true;
  if (resolvedSource === "/") return resolvedDestination.startsWith("/");
  return resolvedDestination.startsWith(`${resolvedSource}/`);
}

/** The exact device/inode identity used by Node's copy path checks. */
export interface CpFileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
}

export function cpStatsAreIdentical(
  source: CpFileIdentity,
  destination: CpFileIdentity,
): boolean {
  return destination.ino !== 0n && destination.dev !== 0n &&
    destination.ino === source.ino && destination.dev === source.dev;
}

export type CpErrorCode =
  | "ERR_FS_CP_DIR_TO_NON_DIR"
  | "ERR_FS_CP_EEXIST"
  | "ERR_FS_CP_EINVAL"
  | "ERR_FS_CP_FIFO_PIPE"
  | "ERR_FS_CP_NON_DIR_TO_DIR"
  | "ERR_FS_CP_SOCKET"
  | "ERR_FS_CP_SYMLINK_TO_SUBDIRECTORY"
  | "ERR_FS_CP_UNKNOWN"
  | "ERR_FS_EISDIR";

export type CpSystemCode = "EEXIST" | "EISDIR" | "EINVAL" | "ENOTDIR";

export interface CpErrorInfo {
  readonly message: string;
  readonly path: string;
  readonly syscall: "cp";
  readonly errno: number;
  readonly code: CpSystemCode;
}

function cpErrorPrefix(code: CpErrorCode): string {
  switch (code) {
    case "ERR_FS_CP_DIR_TO_NON_DIR":
      return "Cannot overwrite non-directory with directory";
    case "ERR_FS_CP_EEXIST":
      return "Target already exists";
    case "ERR_FS_CP_EINVAL":
      return "Invalid src or dest";
    case "ERR_FS_CP_FIFO_PIPE":
      return "Cannot copy a FIFO pipe";
    case "ERR_FS_CP_NON_DIR_TO_DIR":
      return "Cannot overwrite directory with non-directory";
    case "ERR_FS_CP_SOCKET":
      return "Cannot copy a socket file";
    case "ERR_FS_CP_SYMLINK_TO_SUBDIRECTORY":
      return "Cannot overwrite symlink in subdirectory of self";
    case "ERR_FS_CP_UNKNOWN":
      return "Cannot copy an unknown file type";
    case "ERR_FS_EISDIR":
      return "Path is a directory";
  }
}

function cpErrno(code: CpSystemCode): number {
  switch (code) {
    case "EEXIST": return 17;
    case "EISDIR": return 21;
    case "EINVAL": return 22;
    case "ENOTDIR": return 20;
  }
}

/** Fixed-layout equivalent of Node's CP-specific `SystemError` subclasses. */
export class CpSystemError extends Error {
  readonly code: CpErrorCode;
  readonly info: CpErrorInfo;
  errno: number;
  readonly syscall = "cp";
  readonly path: string;

  constructor(
    code: CpErrorCode,
    systemCode: CpSystemCode,
    message: string,
    path: string,
  ) {
    const errno = cpErrno(systemCode);
    super(
      `${cpErrorPrefix(code)}: cp returned ${systemCode} (${message}) ${path}`,
    );
    this.name = "SystemError";
    this.code = code;
    this.errno = errno;
    this.path = path;
    this.info = {
      message,
      path,
      syscall: "cp",
      errno,
      code: systemCode,
    };
  }

  override toString(): string {
    return `${this.name} [${this.code}]: ${this.message}`;
  }
}

export function cpInvalidPath(message: string, path: string): CpSystemError {
  return new CpSystemError("ERR_FS_CP_EINVAL", "EINVAL", message, path);
}
