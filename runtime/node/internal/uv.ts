// libuv's error names and messages, and the exception node builds from them.
//
// Node reaches these through `internalBinding('uv')`, which exposes libuv's own
// `uv_err_name` and `uv_strerror`. Taking them from libuv rather than from a
// table written here is the same argument as `os.constants`: the numbers and
// the wording are the platform's, and a transcribed copy would drift.

declare function nts_uv_err_name(code: number): string;
declare function nts_uv_err_message(code: number): string;

/** libuv's name for a negative errno: `-2` is `ENOENT`. */
export const errName = nts_uv_err_name;
export const errMessage = nts_uv_err_message;

/**
 * The exception every failing `fs` call throws.
 *
 *   ENOENT: no such file or directory, stat '/nope/x'
 *
 * It is an ordinary `Error` with `code`, `errno`, `syscall` and `path` on it,
 * not a subclass -- node's `uvException` builds one that way and programs
 * check `err.code`, so the shape is the contract.
 */
export interface UVError extends Error {
  code: string;
  errno: number;
  syscall: string;
  path?: string;
  dest?: string;
  filename?: string;
}

/** Static representation of Node's Error-with-libuv-fields shape. */
class UVExceptionError extends Error implements UVError {
  code: string;
  errno: number;
  syscall: string;
  path?: string;
  dest?: string;
  filename?: string;

  constructor(
    message: string,
    code: string,
    errno: number,
    syscall: string,
    path?: string,
    dest?: string,
  ) {
    super(message);
    this.code = code;
    this.errno = errno;
    this.syscall = syscall;
    this.path = path;
    this.dest = dest;
    this.filename = undefined;
  }
}

export function uvException(
  code: number,
  syscall: string,
  path?: string,
  dest?: string,
): UVError {
  const name = nts_uv_err_name(code);
  const description = nts_uv_err_message(code);
  let message = `${name}: ${description}, ${syscall}`;
  if (path !== undefined) {
    message += ` '${path}'`;
  }
  if (dest !== undefined) {
    message += ` -> '${dest}'`;
  }

  return new UVExceptionError(message, name, code, syscall, path, dest);
}

/**
 * The other error shape node uses for a failed system call.
 *
 *   EPERM, Operation not permitted
 *
 * Node has two, and which one a call throws depends on which C++ helper it
 * went through rather than on anything a caller can see. The `fs` family gets
 * `uvException` above -- code, description, syscall and path. The credential
 * calls (`setuid`, `setgid`, `setgroups` and their effective forms) get this
 * one, which names no syscall and no path.
 *
 * Reproduced rather than unified because node's own tests match on the text:
 * `process.setegid` is asserted to fail with something *ending* in
 * `EPERM, ...`, which the other shape does not, since it puts the syscall
 * last.
 */
export function errnoException(code: number, syscall: string): UVError {
  const name = nts_uv_err_name(code);
  return new UVExceptionError(
    `${name}, ${nts_uv_err_message(code)}`,
    name,
    code,
    syscall,
  );
}

/** The closed context carried by Node's `SystemError`. */
export interface SystemErrorInfo {
  errno: number;
  code: string;
  message: string;
  syscall: string;
  path?: string;
  dest?: string;
}

/**
 * A failed libuv operation reported through Node's `ERR_SYSTEM_ERROR` shape.
 *
 * Node installs `errno` and `syscall` as accessors onto a dynamic Error
 * object. NTS has fixed layouts, so these are ordinary typed fields referring
 * to the same values also retained in `info`.
 */
export interface SystemError extends Error {
  readonly code: "ERR_SYSTEM_ERROR";
  readonly info: SystemErrorInfo;
  errno: number;
  syscall: string;
}

class SystemErrorException extends Error implements SystemError {
  readonly code = "ERR_SYSTEM_ERROR";
  readonly info: SystemErrorInfo;
  errno: number;
  syscall: string;

  constructor(errno: number, syscall: string, path?: string, dest?: string) {
    const code = nts_uv_err_name(errno);
    const description = nts_uv_err_message(errno);
    let message = `A system error occurred: ${syscall} returned ${code} (${description})`;
    if (path !== undefined) message += ` ${path}`;
    if (dest !== undefined) message += ` => ${dest}`;
    super(message);
    this.name = "SystemError";
    this.errno = errno;
    this.syscall = syscall;
    this.info = {
      errno,
      code,
      message: description,
      syscall,
      path,
      dest,
    };
  }

  override toString(): string {
    return `${this.name} [${this.code}]: ${this.message}`;
  }
}

/** Build the error used by `node:os` when one of its libuv calls fails. */
export function systemError(
  errno: number,
  syscall: string,
  path?: string,
  dest?: string,
): SystemError {
  return new SystemErrorException(errno, syscall, path, dest);
}

/** The fixed-layout form of dgram's `ERR_SOCKET_BUFFER_SIZE`. */
export interface SocketBufferSystemError extends Error {
  readonly code: "ERR_SOCKET_BUFFER_SIZE";
  readonly info: SystemErrorInfo;
  errno: number;
  syscall: string;
}

const SocketBufferSystemErrorClass = class SystemError
  extends Error
  implements SocketBufferSystemError
{
  readonly code = "ERR_SOCKET_BUFFER_SIZE";
  readonly info: SystemErrorInfo;
  errno: number;
  syscall: string;

  constructor(errno: number, receive: boolean) {
    const code = nts_uv_err_name(errno);
    const description = nts_uv_err_message(errno);
    const syscall = `uv_${receive ? "recv" : "send"}_buffer_size`;
    super(
      `Could not get or set buffer size: ${syscall} returned ${code} (${description})`,
    );
    this.name = "SystemError";
    this.errno = errno;
    this.syscall = syscall;
    this.info = { errno, code, message: description, syscall };
  }

  override toString(): string {
    return `${this.name} [${this.code}]: ${this.message}`;
  }
};

export function socketBufferError(errno: number, receive: boolean): SocketBufferSystemError {
  return new SocketBufferSystemErrorClass(errno, receive);
}

/** Static representation of Node's DNSException error shape. */
class DNSExceptionError extends Error implements UVError {
  code: string;
  errno: number;
  syscall: string;
  hostname?: string;

  constructor(code: number, syscall: string, hostname?: string) {
    const systemName = nts_uv_err_name(code);
    const publicCode = systemName === "EAI_NODATA" || systemName === "EAI_NONAME"
      ? "ENOTFOUND"
      : systemName;
    super(`${syscall} ${publicCode}${hostname === undefined ? "" : ` ${hostname}`}`);
    this.code = publicCode;
    this.errno = code;
    this.syscall = syscall;
    this.hostname = hostname;
  }

  override get ["constructor"](): unknown { return Error; }
}

/** A name-resolution failure, including Node's historical ENOTFOUND mapping. */
export function dnsException(code: number, syscall: string, hostname?: string): UVError {
  return new DNSExceptionError(code, syscall, hostname);
}

export interface UVHostPortError extends Error {
  code: string;
  errno: number;
  syscall: string;
  address?: string;
  port?: number;
}

/** Static representation of Node's address-bearing libuv error shape. */
class UVAddressError extends Error implements UVHostPortError {
  code: string;
  errno: number;
  syscall: string;
  address?: string;
  port?: number;

  constructor(
    message: string,
    code: string,
    errno: number,
    syscall: string,
    address?: string,
    port?: number,
  ) {
    super(message);
    this.code = code;
    this.errno = errno;
    this.syscall = syscall;
    this.address = address;
    this.port = port;
  }
}

/**
 * A libuv failure that happened at an address, rather than at a path.
 *
 * A different sentence from `uvException`, and node writes it differently on
 * purpose: `bind EADDRINUSE 0.0.0.0:8080` rather than
 * `EADDRINUSE: address already in use, bind`. What a reader needs first for a
 * socket is *where*, and the whole point of the error is usually that
 * something else is already there.
 *
 * Port zero is omitted rather than printed, because zero does not name a port
 * -- it is the request for any free one, and by the time this is thrown it is
 * not the port anything was tried on.
 *
 * With neither an address nor a port this is node's `ErrnoException` -- plain
 * `getsockname EBADF` -- which is what a socket operation that has no peer to
 * name should throw. That is a third wording, distinct from both `uvException`
 * above (the filesystem's, path first) and `errnoException` (the process
 * credential calls'). Node has all three and its tests match on the text of
 * each, so they stay three.
 */
export function exceptionWithHostPort(
  code: number,
  syscall: string,
  address?: string,
  port?: number,
): UVHostPortError {
  const name = nts_uv_err_name(code);
  let details = "";
  if (port !== undefined && port > 0) details = ` ${address}:${port}`;
  else if (address) details = ` ${address}`;

  return new UVAddressError(
    `${syscall} ${name}${details}`,
    name,
    code,
    syscall,
    address,
    port !== undefined && port > 0 ? port : undefined,
  );
}

/** The newer libuv address error form used by listen failures. */
export function exceptionWithHostPortDescription(
  code: number,
  syscall: string,
  address?: string,
  port?: number,
): UVHostPortError {
  const name = nts_uv_err_name(code);
  let details = "";
  if (port !== undefined && port > 0) details = ` ${address}:${port}`;
  else if (address) details = ` ${address}`;

  return new UVAddressError(
    `${syscall} ${name}: ${nts_uv_err_message(code)}${details}`,
    name,
    code,
    syscall,
    address,
    port !== undefined && port > 0 ? port : undefined,
  );
}
