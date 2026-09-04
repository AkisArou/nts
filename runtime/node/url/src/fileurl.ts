// Between a `file:` URL and a path, from node v24.20.0 `lib/internal/url.js`.
//
// The two are not interchangeable and the conversion is not cosmetic. A path
// may contain characters a URL must escape, a URL may contain escapes a path
// must not, and on Windows the separator differs and a UNC share becomes a
// host. Every one of those is somewhere a naive `replace` produces a path that
// points at the wrong file.

import {
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_INVALID_FILE_URL_HOST,
  ERR_INVALID_FILE_URL_PATH,
  ERR_INVALID_URL_SCHEME,
} from "../../internal/errors.ts";
import { validateObject, validateString } from "../../internal/validators.ts";
import { posix, win32 } from "../../path/src/main.ts";
import { domainToUnicode } from "./idna.ts";
import { URL } from "./url.ts";

declare function nts_platform(): string;

const CHAR_FORWARD_SLASH = 0x2f;
const CHAR_BACKWARD_SLASH = 0x5c;

/** The build's own platform. `windows` in the options overrides it. */
function isWindowsPlatform(): boolean {
  return nts_platform() === "win32";
}

/**
 * `%2F` and `%5C` are rejected rather than decoded.
 *
 * A path segment containing an encoded separator would silently become two
 * segments, which is how a URL that looks confined to one directory turns into
 * one that is not.
 */
function rejectEncodedSeparators(pathname: string, url: URL, windows: boolean): void {
  for (let n = 0; n < pathname.length; n++) {
    if (pathname[n] !== "%") continue;
    const third = (pathname.codePointAt(n + 2) ?? 0) | 0x20;
    if (pathname[n + 1] === "2" && third === 102) {
      throw new ERR_INVALID_FILE_URL_PATH(
        windows
          ? "must not include encoded \\ or / characters"
          : "must not include encoded / characters",
        url,
      );
    }
    if (windows && pathname[n + 1] === "5" && third === 99) {
      throw new ERR_INVALID_FILE_URL_PATH(
        "must not include encoded \\ or / characters",
        url,
      );
    }
  }
}

function pathFromUrlPosix(url: URL): string {
  if (url.hostname !== "") {
    throw new ERR_INVALID_FILE_URL_HOST(nts_platform());
  }
  const pathname = url.pathname;
  rejectEncodedSeparators(pathname, url, false);
  return pathname.includes("%") ? decodeURIComponent(pathname) : pathname;
}

function pathFromUrlWin32(url: URL): string {
  const hostname = url.hostname;
  let pathname = url.pathname;
  rejectEncodedSeparators(pathname, url, true);

  pathname = pathname.replaceAll("/", "\\");
  if (pathname.includes("%")) {
    pathname = decodeURIComponent(pathname);
  }
  if (hostname !== "") {
    // A host on a `file:` URL is a UNC share. Through `domainToUnicode` in
    // case the parser encoded it as Punycode on the way in.
    return `\\\\${domainToUnicode(hostname)}${pathname}`;
  }
  // Otherwise the first segment has to be a drive letter, or there is no way
  // to say which volume the path is on.
  const letter = (pathname.codePointAt(1) ?? 0) | 0x20;
  const sep = pathname.charAt(2);
  if (letter < 0x61 || letter > 0x7a || sep !== ":") {
    throw new ERR_INVALID_FILE_URL_PATH("must be absolute", url);
  }
  return pathname.slice(1);
}

export interface FileUrlOptions {
  /** Force the Windows rules, whatever the build's platform. */
  windows?: boolean | undefined;
}

export function fileURLToPath(path: string | URL, options?: FileUrlOptions): string {
  const windows = options?.windows;
  let url: URL;
  if (typeof path === "string") {
    url = new URL(path);
  } else if (path instanceof URL) {
    url = path;
  } else {
    throw new ERR_INVALID_ARG_TYPE("path", ["string", "URL"], path);
  }
  if (url.protocol !== "file:") {
    throw new ERR_INVALID_URL_SCHEME("file");
  }
  return (windows ?? isWindowsPlatform()) ? pathFromUrlWin32(url) : pathFromUrlPosix(url);
}

/**
 * The characters a path may contain that a `file:` URL must escape.
 *
 * `#` and `?` would end the path and start a fragment or a query; the rest are
 * escaped because a URL in running text would otherwise be ambiguous about
 * where it ends.
 */
function encodePathChars(filepath: string, windows: boolean): string {
  let encoded = "";
  for (const character of filepath) {
    const code = character.codePointAt(0) ?? 0;
    const unsafeAscii =
      code <= 0x20 ||
      code === 0x22 || // "
      code === 0x23 || // #
      code === 0x25 || // %
      code === 0x3c || // <
      code === 0x3e || // >
      code === 0x3f || // ?
      code === 0x5b || // [
      code === 0x5d || // ]
      code === 0x5e || // ^
      code === 0x60 || // `
      code === 0x7b || // {
      code === 0x7c || // |
      code === 0x7d || // }
      code === 0x7e || // ~
      code === 0x7f ||
      (!windows && code === CHAR_BACKWARD_SLASH);
    encoded += unsafeAscii
      ? `%${code.toString(16).toUpperCase().padStart(2, "0")}`
      : character;
  }
  return encoded;
}

/**
 * Apply the URL parser's hostname-state rules to the server part of a UNC path.
 *
 * Node finds the resource boundary at the first backslash, then parses the
 * preceding text as a URL hostname. `/`, `?`, and `#` end that hostname; any
 * text between the terminator and the resource boundary is consequently not
 * part of either the server or the resource. ASCII tab and newlines are ignored
 * by URL parsing rather than percent-encoded.
 */
function normalizeUncHostname(input: string): string {
  let hostname = "";
  for (const character of input) {
    if (character === "/" || character === "?" || character === "#") {
      break;
    }
    if (character !== "\t" && character !== "\n" && character !== "\r") {
      hostname += character;
    }
  }
  return hostname;
}

export function pathToFileURL(filepath: string, options?: FileUrlOptions): URL {
  validateString(filepath, "path");
  const windows = options?.windows ?? isWindowsPlatform();
  const isUNC = windows && filepath.startsWith("\\\\");
  let resolved = isUNC ? filepath : (windows ? win32.resolve(filepath) : posix.resolve(filepath));

  const isExtendedLocalPath =
    windows && resolved.startsWith("\\\\?\\") && !resolved.startsWith("\\\\?\\UNC\\");
  if (isExtendedLocalPath) {
    resolved = resolved.slice(4);
  } else if (isUNC || (windows && resolved.startsWith("\\\\"))) {
    // `\\server\share\resource`, possibly with the extended `\\?\UNC\`
    // prefix, which names the same thing and is ignored.
    const isExtendedUNC = resolved.startsWith("\\\\?\\UNC\\");
    const prefixLength = isExtendedUNC ? 8 : 2;
    const hostnameEndIndex = resolved.indexOf("\\", prefixLength);
    if (hostnameEndIndex === -1) {
      throw new ERR_INVALID_ARG_VALUE("path", resolved, "Missing UNC resource path");
    }
    const hostname = normalizeUncHostname(resolved.slice(prefixLength, hostnameEndIndex));
    if (hostname === "") {
      throw new ERR_INVALID_ARG_VALUE("path", resolved, "Empty UNC servername");
    }
    const rest = encodePathChars(resolved.slice(hostnameEndIndex), true).replaceAll("\\", "/");
    return new URL(`file://${hostname}${rest}`);
  }

  // `resolve` strips a trailing separator, and the caller meant a directory.
  const last = filepath.charCodeAt(filepath.length - 1);
  const sep = windows ? win32.sep : posix.sep;
  if (
    (last === CHAR_FORWARD_SLASH || (windows && last === CHAR_BACKWARD_SLASH)) &&
    resolved[resolved.length - 1] !== sep
  ) {
    resolved += "/";
  }

  let encoded = encodePathChars(resolved, windows);
  if (windows) {
    encoded = encoded.replaceAll("\\", "/");
    return new URL(`file:///${encoded}`);
  }
  return new URL(`file://${encoded}`);
}

/** What `http.request` wants: a URL taken apart into its options. */
export function urlToHttpOptions(url: URL): Record<string, unknown> {
  validateObject(url, "url");
  const { hostname, pathname, port, username, password, search } = url;
  const options: Record<string, unknown> = {
    protocol: url.protocol,
    // An IPv6 literal is bracketed in a URL and bare in a socket address.
    hostname: hostname && hostname[0] === "[" ? hostname.slice(1, -1) : hostname,
    hash: url.hash,
    search,
    pathname,
    path: `${pathname || ""}${search || ""}`,
    href: url.href,
  };
  if (port !== "") {
    options["port"] = Number(port);
  }
  if (username || password) {
    options["auth"] = `${decodeURIComponent(username)}:${decodeURIComponent(password)}`;
  }
  return options;
}
