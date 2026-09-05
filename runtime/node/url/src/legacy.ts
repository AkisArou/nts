// `url.parse`, `url.format` and `url.resolve`, from node v24.20.0
// `lib/url.js`.
//
// Node's own URL handling, predating the WHATWG standard by five years. Its
// behaviour is not specified anywhere and node's documentation warns against
// it by name: it is lenient where the standard fails, and the two disagree
// about several inputs. It is here because a great deal of code still calls
// it, and because "we implement `node:url`" is not true without it.
//
// Kept in its own file for that reason. Nothing in `parser.ts` is allowed to
// depend on this, so that the standard's rules and node's cannot be confused
// for one another by a reader or by a later edit.
//
// The transcription is close to upstream, including the single-pass scans that
// look like premature optimisation and are not: `url.parse` is on the hot path
// of every HTTP server written before 2018.

import {
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_URI,
  ERR_INVALID_URL,
} from "../../internal/errors.ts";
import { validateObject, validateString } from "../../internal/validators.ts";
import {
  parse as parseQuery,
  stringify as stringifyQuery,
  type ParsedUrlQuery,
} from "../../querystring/src/main.ts";
import { emitWarning } from "../../internal/process-warning.ts";
import { URL } from "./url.ts";
import { domainToASCII, domainToUnicode } from "./idna.ts";

const CHAR_TAB = 9;
const CHAR_LINE_FEED = 10;
const CHAR_CARRIAGE_RETURN = 13;
const CHAR_SPACE = 32;
const CHAR_DOUBLE_QUOTE = 34;
const CHAR_HASH = 35;
const CHAR_PERCENT = 37;
const CHAR_SINGLE_QUOTE = 39;
const CHAR_FORWARD_SLASH = 47;
const CHAR_COLON = 58;
const CHAR_SEMICOLON = 59;
const CHAR_LEFT_ANGLE_BRACKET = 60;
const CHAR_RIGHT_ANGLE_BRACKET = 62;
const CHAR_QUESTION_MARK = 63;
const CHAR_AT = 64;
const CHAR_LEFT_SQUARE_BRACKET = 91;
const CHAR_BACKWARD_SLASH = 92;
const CHAR_RIGHT_SQUARE_BRACKET = 93;
const CHAR_CIRCUMFLEX_ACCENT = 94;
const CHAR_GRAVE_ACCENT = 96;
const CHAR_LEFT_CURLY_BRACKET = 123;
const CHAR_VERTICAL_LINE = 124;
const CHAR_RIGHT_CURLY_BRACKET = 125;
const CHAR_NO_BREAK_SPACE = 160;
const CHAR_ZERO_WIDTH_NOBREAK_SPACE = 0xfeff;

function isAsciiProtocolCode(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x2b || code === 0x2d || code === 0x2e;
}

function leadingProtocol(input: string): string | null {
  let end = 0;
  while (end < input.length && isAsciiProtocolCode(input.charCodeAt(end))) end++;
  return end > 0 && input.charCodeAt(end) === CHAR_COLON
    ? input.slice(0, end + 1)
    : null;
}

/** Whether `//user@host` has non-empty text on both sides of the first `@`. */
function startsWithCredentialHost(input: string): boolean {
  if (input.charCodeAt(0) !== CHAR_FORWARD_SLASH ||
      input.charCodeAt(1) !== CHAR_FORWARD_SLASH) {
    return false;
  }

  let index = 2;
  const authStart = index;
  while (index < input.length && input[index] !== "@" && input[index] !== "/") index++;
  if (index === authStart || input[index] !== "@") return false;

  index++;
  const hostStart = index;
  while (index < input.length && input[index] !== "@" && input[index] !== "/") index++;
  return index > hostStart;
}

function isEcmaWhitespace(code: number): boolean {
  return (code >= 0x09 && code <= 0x0d) ||
    code === 0x20 || code === 0xa0 || code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 || code === 0x2029 || code === 0x202f ||
    code === 0x205f || code === 0x3000 || code === 0xfeff;
}

interface SimplePath {
  pathname: string;
  search: string | null;
}

/** A path with no scheme, host or fragment: the common case, taken whole. */
function parseSimplePath(input: string): SimplePath | null {
  if (input.charCodeAt(0) !== CHAR_FORWARD_SLASH ||
      (input.charCodeAt(1) === CHAR_FORWARD_SLASH &&
       input.charCodeAt(2) === CHAR_FORWARD_SLASH)) {
    return null;
  }

  let question = -1;
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    if (isEcmaWhitespace(code)) return null;
    if (question === -1 && code === CHAR_QUESTION_MARK) question = index;
  }
  return question === -1
    ? { pathname: input, search: null }
    : { pathname: input.slice(0, question), search: input.slice(question) };
}

function trailingPort(host: string): string | null {
  let colon = host.length - 1;
  while (colon >= 0) {
    const code = host.charCodeAt(colon);
    if (code < 0x30 || code > 0x39) break;
    colon--;
  }
  return colon >= 0 && host.charCodeAt(colon) === CHAR_COLON
    ? host.slice(colon)
    : null;
}

const hostnameMaxLen = 255;

/** `javascript:` is never given a host, and never auto-escaped. */
function isJavascriptProtocol(protocol: string): boolean {
  return protocol === "javascript" || protocol === "javascript:";
}

/** The schemes that always carry `//`, so `mailto:` and `xmpp:` do not. */
function isSlashedProtocol(protocol: string): boolean {
  switch (protocol) {
    case "http":
    case "http:":
    case "https":
    case "https:":
    case "ftp":
    case "ftp:":
    case "gopher":
    case "gopher:":
    case "file":
    case "file:":
    case "ws":
    case "ws:":
    case "wss":
    case "wss:":
      return true;
    default:
      return false;
  }
}

/**
 * The characters that must never reach a hostname, whatever IDNA does with it.
 *
 * The intersection of the standard's forbidden host code points and what the
 * parse loop below already rejects, plus three of its own: `:` would let a
 * hostname spoof a scheme, `@` would let part of it be read as credentials,
 * and `[`/`]` would let a name be mistaken for an IPv6 literal.
 */
function containsForbiddenHostChar(hostname: string, ipv6: boolean): boolean {
  for (let index = 0; index < hostname.length; index++) {
    switch (hostname.charCodeAt(index)) {
      case 0x00:
      case CHAR_TAB:
      case CHAR_LINE_FEED:
      case CHAR_CARRIAGE_RETURN:
      case CHAR_SPACE:
      case CHAR_HASH:
      case CHAR_PERCENT:
      case CHAR_FORWARD_SLASH:
      case CHAR_LEFT_ANGLE_BRACKET:
      case CHAR_RIGHT_ANGLE_BRACKET:
      case CHAR_QUESTION_MARK:
      case CHAR_AT:
      case CHAR_BACKWARD_SLASH:
      case CHAR_CIRCUMFLEX_ACCENT:
      case CHAR_VERTICAL_LINE:
        return true;
      case CHAR_COLON:
      case CHAR_LEFT_SQUARE_BRACKET:
      case CHAR_RIGHT_SQUARE_BRACKET:
        if (!ipv6) return true;
        break;
    }
  }
  return false;
}

export type LegacyQuery = string | ParsedUrlQuery | null;

/** The statically readable fields accepted by legacy `url.format(object)`. */
export interface LegacyUrlLike {
  protocol?: string | null;
  slashes?: boolean | null;
  auth?: string | null;
  host?: string | null;
  port?: string | null;
  hostname?: string | null;
  hash?: string | null;
  search?: string | null;
  query?: LegacyQuery;
  pathname?: string | null;
}

/** Copy the fixed legacy URL record without a dynamic property walk. */
function copyUrl(target: Url, source: Url, includeProtocol = true): void {
  if (includeProtocol) target.protocol = source.protocol;
  target.slashes = source.slashes;
  target.auth = source.auth;
  target.host = source.host;
  target.port = source.port;
  target.hostname = source.hostname;
  target.hash = source.hash;
  target.search = source.search;
  target.query = source.query;
  target.pathname = source.pathname;
  target.path = source.path;
  target.href = source.href;
}

export class Url {
  protocol: string | null = null;
  slashes: boolean | null = null;
  auth: string | null = null;
  host: string | null = null;
  port: string | null = null;
  hostname: string | null = null;
  hash: string | null = null;
  search: string | null = null;
  query: LegacyQuery = null;
  pathname: string | null = null;
  path: string | null = null;
  href: string | null = null;

  parse(url: string, parseQueryString?: boolean, slashesDenoteHost?: boolean): this {
    validateString(url, "url");

    // One pass that does three things at once: find the first and last
    // non-whitespace characters, note whether the URL has a `#` or an `@`,
    // and turn backslashes before the query into forward slashes -- which is
    // what browsers do, and what a great deal of Windows-authored input needs.
    let hasHash = false;
    let hasAt = false;
    let start = -1;
    let end = -1;
    let rest = "";
    let lastPos = 0;
    for (let i = 0, inWs = false, split = false; i < url.length; ++i) {
      const code = url.charCodeAt(i);

      const isWs = code < 33 ||
        code === CHAR_NO_BREAK_SPACE ||
        code === CHAR_ZERO_WIDTH_NOBREAK_SPACE;
      if (start === -1) {
        if (isWs) continue;
        lastPos = start = i;
      } else if (inWs) {
        if (!isWs) {
          end = -1;
          inWs = false;
        }
      } else if (isWs) {
        end = i;
        inWs = true;
      }

      if (!split) {
        switch (code) {
          case CHAR_AT:
            hasAt = true;
            break;
          case CHAR_HASH:
            hasHash = true;
            split = true;
            break;
          case CHAR_QUESTION_MARK:
            split = true;
            break;
          case CHAR_BACKWARD_SLASH:
            if (i - lastPos > 0) rest += url.slice(lastPos, i);
            rest += "/";
            lastPos = i + 1;
            break;
        }
      } else if (!hasHash && code === CHAR_HASH) {
        hasHash = true;
      }
    }

    if (start !== -1) {
      if (lastPos === start) {
        if (end === -1) {
          rest = start === 0 ? url : url.slice(start);
        } else {
          rest = url.slice(start, end);
        }
      } else if (end === -1 && lastPos < url.length) {
        rest += url.slice(lastPos);
      } else if (end !== -1 && lastPos < end) {
        rest += url.slice(lastPos, end);
      }
    }

    if (!slashesDenoteHost && !hasHash && !hasAt) {
      const simplePath = parseSimplePath(rest);
      if (simplePath) {
        this.path = rest;
        this.href = rest;
        this.pathname = simplePath.pathname;
        if (simplePath.search !== null) {
          this.search = simplePath.search;
          this.query = parseQueryString
            ? parseQuery(this.search.slice(1))
            : this.search.slice(1);
        } else if (parseQueryString) {
          this.search = null;
          // Compiled records have no prototype, so an empty typed record is
          // already the representation Node seeks with `Object.create(null)`.
          this.query = {};
        }
        return this;
      }
    }

    const proto = leadingProtocol(rest);
    let lowerProto: string | undefined;
    if (proto) {
      lowerProto = proto.toLowerCase();
      this.protocol = lowerProto;
      rest = rest.slice(proto.length);
    }

    // `user@server` is always a hostname, and `//foo/bar` is always host `foo`
    // -- that is how a browser resolves a protocol-relative reference.
    let slashes = false;
    if (slashesDenoteHost || proto || startsWithCredentialHost(rest)) {
      slashes = rest.charCodeAt(0) === CHAR_FORWARD_SLASH &&
        rest.charCodeAt(1) === CHAR_FORWARD_SLASH;
      if (slashes && !(proto && isJavascriptProtocol(lowerProto ?? ""))) {
        rest = rest.slice(2);
        this.slashes = true;
      }
    }

    if (
      !isJavascriptProtocol(lowerProto ?? "") &&
      (slashes || (proto && !isSlashedProtocol(proto)))
    ) {
      // The host ends at the first `/`, `?`, `;` or `#`. An `@` moves that
      // boundary: everything before the *last* `@` is credentials, and so may
      // contain characters a host may not -- unless a host-ending character
      // came first. `http://a@b@c/` is user `a@b` and host `c`; `http://a@b?@c`
      // is user `a`, host `b`, path `/?@c`.
      let hostEnd = -1;
      let atSign = -1;
      let nonHost = -1;
      for (let i = 0; i < rest.length; ++i) {
        switch (rest.charCodeAt(i)) {
          case CHAR_TAB:
          case CHAR_LINE_FEED:
          case CHAR_CARRIAGE_RETURN:
            // Removed wherever they appear, as the standard does.
            rest = rest.slice(0, i) + rest.slice(i + 1);
            i -= 1;
            break;
          case CHAR_SPACE:
          case CHAR_DOUBLE_QUOTE:
          case CHAR_PERCENT:
          case CHAR_SINGLE_QUOTE:
          case CHAR_SEMICOLON:
          case CHAR_LEFT_ANGLE_BRACKET:
          case CHAR_RIGHT_ANGLE_BRACKET:
          case CHAR_BACKWARD_SLASH:
          case CHAR_CIRCUMFLEX_ACCENT:
          case CHAR_GRAVE_ACCENT:
          case CHAR_LEFT_CURLY_BRACKET:
          case CHAR_VERTICAL_LINE:
          case CHAR_RIGHT_CURLY_BRACKET:
            // Never allowed in a hostname, per RFC 2396.
            if (nonHost === -1) nonHost = i;
            break;
          case CHAR_HASH:
          case CHAR_FORWARD_SLASH:
          case CHAR_QUESTION_MARK:
            if (nonHost === -1) nonHost = i;
            hostEnd = i;
            break;
          case CHAR_AT:
            atSign = i;
            nonHost = -1;
            break;
        }
        if (hostEnd !== -1) break;
      }
      start = 0;
      if (atSign !== -1) {
        this.auth = decodeURIComponent(rest.slice(0, atSign));
        start = atSign + 1;
      }
      if (nonHost === -1) {
        this.host = rest.slice(start);
        rest = "";
      } else {
        this.host = rest.slice(start, nonHost);
        rest = rest.slice(nonHost);
      }

      this.parseHost();

      // A URL that has a host at all has a hostname, even an empty one.
      let hostname = this.hostname ?? "";
      const ipv6Hostname = isIpv6Hostname(hostname);

      if (!ipv6Hostname) {
        rest = getHostname(this, rest, hostname, url);
        hostname = this.hostname ?? "";
      }

      if (hostname.length > hostnameMaxLen) {
        hostname = "";
      } else {
        hostname = hostname.toLowerCase();
      }

      if (hostname !== "") {
        if (ipv6Hostname) {
          if (containsForbiddenHostChar(hostname, true)) {
            throw new ERR_INVALID_URL(url);
          }
        } else {
          hostname = domainToASCII(hostname) ?? "";

          // Two spoofing routes, both closed here rather than corrected.
          // An empty hostname now must have been emptied by the IDNA step,
          // since it was non-empty above; a forbidden character now must have
          // been introduced by it, since the loop would have rejected one.
          // Either is severe enough to throw rather than repair.
          if (hostname === "" || containsForbiddenHostChar(hostname, false)) {
            throw new ERR_INVALID_URL(url);
          }
        }
      }

      this.hostname = hostname;

      const p = this.port ? `:${this.port}` : "";
      const h = this.hostname || "";
      this.host = h + p;

      // `host` keeps the brackets, `hostname` does not.
      if (ipv6Hostname) {
        this.hostname = hostname.slice(1, -1);
        if (rest[0] !== "/") {
          rest = `/${rest}`;
        }
      }
    }

    if (!isJavascriptProtocol(lowerProto ?? "")) {
      // Delimiters and RFC 2396's "unwise" characters, escaped even where
      // `encodeURIComponent` would leave them -- including the single quote,
      // which would otherwise close an attribute in generated HTML.
      rest = autoEscapeStr(rest);
    }

    let questionIdx = -1;
    let hashIdx = -1;
    for (let i = 0; i < rest.length; ++i) {
      const code = rest.charCodeAt(i);
      if (code === CHAR_HASH) {
        this.hash = rest.slice(i);
        hashIdx = i;
        break;
      } else if (code === CHAR_QUESTION_MARK && questionIdx === -1) {
        questionIdx = i;
      }
    }

    if (questionIdx !== -1) {
      if (hashIdx === -1) {
        this.search = rest.slice(questionIdx);
        this.query = rest.slice(questionIdx + 1);
      } else {
        this.search = rest.slice(questionIdx, hashIdx);
        this.query = rest.slice(questionIdx + 1, hashIdx);
      }
      if (parseQueryString) this.query = parseQuery(this.query);
    } else if (parseQueryString) {
      this.search = null;
      this.query = {};
    }

    const useQuestionIdx = questionIdx !== -1 && (hashIdx === -1 || questionIdx < hashIdx);
    const firstIdx = useQuestionIdx ? questionIdx : hashIdx;
    if (firstIdx === -1) {
      if (rest.length > 0) this.pathname = rest;
    } else if (firstIdx > 0) {
      this.pathname = rest.slice(0, firstIdx);
    }
    if (isSlashedProtocol(lowerProto ?? "") && this.hostname && !this.pathname) {
      this.pathname = "/";
    }

    // `path` is what `http.request` wants: the request target in one string.
    if (this.pathname || this.search) {
      this.path = (this.pathname || "") + (this.search || "");
    }

    this.href = this.format();
    return this;
  }

  format(): string {
    return formatLegacyUrl(this);
  }

  resolve(relative: string): string {
    return this.resolveObject(urlParse(relative, false, true)).format();
  }

  resolveObject(relative: string | Url): Url {
    if (typeof relative === "string") {
      const rel = new Url();
      rel.parse(relative, false, true);
      relative = rel;
    }

    const result = new Url();
    copyUrl(result, this);

    // The fragment is always replaced, even by an empty reference.
    result.hash = relative.hash;

    if (relative.href === "") {
      result.href = result.format();
      return result;
    }

    // `//foo/bar` keeps only the scheme.
    if (relative.slashes && !relative.protocol) {
      copyUrl(result, relative, false);

      if (isSlashedProtocol(result.protocol ?? "") && result.hostname && !result.pathname) {
        result.path = result.pathname = "/";
      }

      result.href = result.format();
      return result;
    }

    if (relative.protocol && relative.protocol !== result.protocol) {
      // Changing the scheme changes the rules. An unknown scheme is taken
      // whole; a known one must have a host, and the first path segment
      // becomes it when there is none.
      if (!isSlashedProtocol(relative.protocol)) {
        copyUrl(result, relative);
        result.href = result.format();
        return result;
      }

      result.protocol = relative.protocol;
      if (
        !relative.host &&
        relative.protocol !== "file" && relative.protocol !== "file:" &&
        !isJavascriptProtocol(relative.protocol)
      ) {
        const relPath = (relative.pathname || "").split("/");
        while (relPath.length && !(relative.host = relPath.shift() ?? null));
        relative.host ||= "";
        relative.hostname ||= "";
        if (relPath[0] !== "") relPath.unshift("");
        if (relPath.length < 2) relPath.unshift("");
        result.pathname = relPath.join("/");
      } else {
        result.pathname = relative.pathname;
      }
      result.search = relative.search;
      result.query = relative.query;
      result.host = relative.host || "";
      result.auth = relative.auth;
      result.hostname = relative.hostname || relative.host;
      result.port = relative.port;
      if (result.pathname || result.search) {
        result.path = (result.pathname || "") + (result.search || "");
      }
      result.slashes ||= relative.slashes;
      result.href = result.format();
      return result;
    }

    const isSourceAbs = Boolean(result.pathname && result.pathname.charAt(0) === "/");
    const isRelAbs = Boolean(
      relative.host || (relative.pathname && relative.pathname.charAt(0) === "/"),
    );
    let mustEndAbs = Boolean(isRelAbs || isSourceAbs || (result.host && relative.pathname));
    const removeAllDots = mustEndAbs;
    let srcPath = (result.pathname && result.pathname.split("/")) || [];
    const relPath = (relative.pathname && relative.pathname.split("/")) || [];
    const noLeadingSlashes = Boolean(result.protocol && !isSlashedProtocol(result.protocol));

    // For a scheme with no `//`, `../..` may climb past what would elsewhere
    // be the host, so the host is folded into the path for the walk below and
    // taken back out afterwards.
    if (noLeadingSlashes) {
      result.hostname = "";
      result.port = null;
      if (result.host) {
        if (srcPath[0] === "") srcPath[0] = result.host;
        else srcPath.unshift(result.host);
      }
      result.host = "";
      if (relative.protocol) {
        relative.hostname = null;
        relative.port = null;
        result.auth = null;
        if (relative.host) {
          if (relPath[0] === "") relPath[0] = relative.host;
          else relPath.unshift(relative.host);
        }
        relative.host = null;
      }
      mustEndAbs &&= (relPath[0] === "" || srcPath[0] === "");
    }

    if (isRelAbs) {
      if (relative.host || relative.host === "") {
        if (result.host !== relative.host) result.auth = null;
        result.host = relative.host;
        result.port = relative.port;
      }
      if (relative.hostname || relative.hostname === "") {
        if (result.hostname !== relative.hostname) result.auth = null;
        result.hostname = relative.hostname;
      }
      result.search = relative.search;
      result.query = relative.query;
      srcPath = relPath;
    } else if (relPath.length) {
      // Relative: drop the last segment of the base and append.
      srcPath.pop();
      srcPath = srcPath.concat(relPath);
      result.search = relative.search;
      result.query = relative.query;
    } else if (relative.search !== null && relative.search !== undefined) {
      // `?foo` alone: keep the path and take only the query. Last, because
      // it is the case the two above do not cover rather than a case of
      // its own.
      if (noLeadingSlashes) {
        result.hostname = result.host = srcPath.shift() ?? null;
        // The credentials can end up stuck in the host, as in
        // `resolveObject('mailto:local1@domain1', 'local2@domain2')`.
        const authInHost = result.host && result.host.indexOf("@") > 0
          ? result.host.split("@")
          : false;
        if (authInHost) {
          result.auth = authInHost.shift() ?? null;
          result.host = result.hostname = authInHost.shift() ?? null;
        }
      }
      result.search = relative.search;
      result.query = relative.query;
      if (result.pathname !== null || result.search !== null) {
        result.path = (result.pathname || "") + (result.search || "");
      }
      result.href = result.format();
      return result;
    }

    if (!srcPath.length) {
      result.pathname = null;
      result.path = result.search ? `/${result.search}` : null;
      result.href = result.format();
      return result;
    }

    // A path ending in `.` or `..` gets a trailing slash; one ending in
    // anything else does not.
    let last = srcPath[srcPath.length - 1];
    const hasTrailingSlash =
      (((result.host || relative.host || srcPath.length > 1) &&
        (last === "." || last === "..")) || last === "");

    // Backwards, so that removing a segment does not disturb the ones not yet
    // examined. `up` counts the `..` that walked past the root.
    let up = 0;
    for (let i = srcPath.length - 1; i >= 0; i--) {
      last = srcPath[i];
      if (last === ".") {
        srcPath.splice(i, 1);
      } else if (last === "..") {
        srcPath.splice(i, 1);
        up++;
      } else if (up) {
        srcPath.splice(i, 1);
        up--;
      }
    }

    if (!mustEndAbs && !removeAllDots) {
      while (up--) {
        srcPath.unshift("..");
      }
    }

    if (mustEndAbs && srcPath[0] !== "" && (!srcPath[0] || srcPath[0].charAt(0) !== "/")) {
      srcPath.unshift("");
    }

    if (hasTrailingSlash && srcPath.join("/").at(-1) !== "/") {
      srcPath.push("");
    }

    const isAbsolute = srcPath[0] === "" || (srcPath[0] !== undefined && srcPath[0].charAt(0) === "/");

    if (noLeadingSlashes) {
      result.hostname = result.host =
        isAbsolute ? "" : srcPath.length ? srcPath.shift() ?? "" : "";
      const authInHost = result.host && result.host.indexOf("@") > 0
        ? result.host.split("@")
        : false;
      if (authInHost) {
        result.auth = authInHost.shift() ?? null;
        result.host = result.hostname = authInHost.shift() ?? null;
      }
    }

    mustEndAbs ||= Boolean(result.host && srcPath.length);

    if (mustEndAbs && !isAbsolute) {
      srcPath.unshift("");
    }

    if (!srcPath.length) {
      result.pathname = null;
      result.path = null;
    } else {
      result.pathname = srcPath.join("/");
    }

    if (result.pathname !== null || result.search !== null) {
      result.path = (result.pathname || "") + (result.search || "");
    }
    result.auth = relative.auth || result.auth;
    result.slashes ||= relative.slashes;
    result.href = result.format();
    return result;
  }

  parseHost(): void {
    let host = this.host ?? "";
    const port = trailingPort(host);
    if (port) {
      if (port !== ":") {
        this.port = port.slice(1);
      }
      host = host.slice(0, host.length - port.length);
    }
    if (host) this.hostname = host;
  }
}

/** Shared formatter for a `Url` instance and the legacy plain-object form. */
function formatLegacyUrl(url: LegacyUrlLike): string {
  let auth = url.auth || "";
  if (auth) {
    auth = encodeAuth(auth);
    auth += "@";
  }

  let protocol = url.protocol || "";
  if (protocol && protocol.charCodeAt(protocol.length - 1) !== CHAR_COLON) {
    protocol += ":";
  }

  let pathname = url.pathname || "";
  let hash = url.hash || "";
  let host = "";
  let query = "";

  if (url.host) {
    host = auth + url.host;
  } else if (url.hostname) {
    host = auth + (
      url.hostname.includes(":") && !isIpv6Hostname(url.hostname)
        ? `[${url.hostname}]`
        : url.hostname
    );
    if (url.port) {
      host += `:${url.port}`;
    }
  }

  if (url.query !== null && url.query !== undefined && typeof url.query === "object") {
    query = stringifyQuery(url.query);
  }
  let search = url.search || (query && `?${query}`) || "";

  // A `#` or `?` inside the path would end it, so they are escaped even when
  // the caller deliberately wrote them into `pathname`.
  if (pathname.includes("#") || pathname.includes("?")) {
    let escapedPathname = "";
    let lastPosition = 0;
    for (let i = 0; i < pathname.length; i++) {
      const code = pathname.charCodeAt(i);
      if (code === CHAR_HASH || code === CHAR_QUESTION_MARK) {
        if (i > lastPosition) escapedPathname += pathname.slice(lastPosition, i);
        escapedPathname += code === CHAR_HASH ? "%23" : "%3F";
        lastPosition = i + 1;
      }
    }
    if (lastPosition < pathname.length) escapedPathname += pathname.slice(lastPosition);
    pathname = escapedPathname;
  }

  if (url.slashes || isSlashedProtocol(protocol)) {
    if (url.slashes || host) {
      if (pathname && pathname.charCodeAt(0) !== CHAR_FORWARD_SLASH) {
        pathname = `/${pathname}`;
      }
      host = `//${host}`;
    } else if (protocol.length >= 4 && protocol.slice(0, 4) === "file") {
      host = "//";
    }
  }

  if (search.includes("#")) {
    search = search.replaceAll("#", "%23");
  }

  if (hash && hash.charCodeAt(0) !== CHAR_HASH) hash = `#${hash}`;
  if (search && search.charCodeAt(0) !== CHAR_QUESTION_MARK) search = `?${search}`;

  return protocol + host + pathname + search + hash;
}

function isIpv6Hostname(hostname: string): boolean {
  return hostname.charCodeAt(0) === CHAR_LEFT_SQUARE_BRACKET &&
    hostname.charCodeAt(hostname.length - 1) === CHAR_RIGHT_SQUARE_BRACKET;
}

let warnInvalidPort = true;

/**
 * Cut the hostname at the first character that cannot be in one, and move the
 * rest into the path.
 *
 * A `:` here means a malformed port. Node is lenient about it -- it warns and
 * carries on -- because throwing would break code that has been working for
 * fifteen years.
 */
function getHostname(self: Url, rest: string, hostname: string, url: string): string {
  for (let i = 0; i < hostname.length; ++i) {
    const code = hostname.charCodeAt(i);
    const isValid = code !== CHAR_FORWARD_SLASH &&
      code !== CHAR_BACKWARD_SLASH &&
      code !== CHAR_HASH &&
      code !== CHAR_QUESTION_MARK &&
      code !== CHAR_COLON;

    if (!isValid) {
      if (warnInvalidPort && code === CHAR_COLON) {
        emitWarning(
          `The URL ${url} is invalid. Future versions of Node.js will throw an error.`,
          "DeprecationWarning",
          "DEP0170",
        );
        warnInvalidPort = false;
      }
      self.hostname = hostname.slice(0, i);
      return `/${hostname.slice(i)}${rest}`;
    }
  }
  return rest;
}

/**
 * The characters `autoEscapeStr` replaces, indexed by code.
 *
 * An array rather than a map because this runs once per character of every URL
 * parsed, and upstream measured the difference.
 */
const escapedCodes: string[] = [
  /* 0 - 9 */ "", "", "", "", "", "", "", "", "", "%09",
  /* 10 - 19 */ "%0A", "", "", "%0D", "", "", "", "", "", "",
  /* 20 - 29 */ "", "", "", "", "", "", "", "", "", "",
  /* 30 - 39 */ "", "", "%20", "", "%22", "", "", "", "", "%27",
  /* 40 - 49 */ "", "", "", "", "", "", "", "", "", "",
  /* 50 - 59 */ "", "", "", "", "", "", "", "", "", "",
  /* 60 - 69 */ "%3C", "", "%3E", "", "", "", "", "", "", "",
  /* 70 - 79 */ "", "", "", "", "", "", "", "", "", "",
  /* 80 - 89 */ "", "", "", "", "", "", "", "", "", "",
  /* 90 - 99 */ "", "", "%5C", "", "%5E", "", "%60", "", "", "",
  /* 100 - 109 */ "", "", "", "", "", "", "", "", "", "",
  /* 110 - 119 */ "", "", "", "", "", "", "", "", "", "",
  /* 120 - 125 */ "", "", "", "%7B", "%7C", "%7D",
];

function autoEscapeStr(rest: string): string {
  let escaped = "";
  let lastEscapedPos = 0;
  for (let i = 0; i < rest.length; ++i) {
    const escapedChar = escapedCodes[rest.charCodeAt(i)];
    if (escapedChar) {
      if (i > lastEscapedPos) escaped += rest.slice(lastEscapedPos, i);
      escaped += escapedChar;
      lastEscapedPos = i + 1;
    }
  }
  if (lastEscapedPos === 0) return rest;
  if (lastEscapedPos < rest.length) escaped += rest.slice(lastEscapedPos);
  return escaped;
}

/**
 * The characters that survive unescaped in the credentials:
 * `! - . _ ~ ' ( ) * :` and the alphanumerics.
 */
function isUnescapedAuthCode(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x21 || (code >= 0x27 && code <= 0x2a) ||
    code === 0x2d || code === 0x2e || code === 0x3a ||
    code === 0x5f || code === 0x7e;
}

function upperHexDigit(code: number): string {
  return String.fromCharCode(code < 10 ? 0x30 + code : 0x41 + code - 10);
}

function percentEncodedByte(byte: number): string {
  return `%${upperHexDigit(byte >> 4)}${upperHexDigit(byte & 0x0f)}`;
}

/** `encodeStr` from `internal/querystring`, with the credentials table. */
function encodeAuth(str: string): string {
  let out = "";
  let lastPos = 0;
  for (let i = 0; i < str.length; ++i) {
    let c = str.charCodeAt(i);

    if (c < 0x80) {
      if (isUnescapedAuthCode(c)) continue;
      if (lastPos < i) out += str.slice(lastPos, i);
      lastPos = i + 1;
      out += percentEncodedByte(c);
      continue;
    }

    if (lastPos < i) out += str.slice(lastPos, i);

    if (c < 0x800) {
      lastPos = i + 1;
      out += percentEncodedByte(0xc0 | (c >> 6)) +
        percentEncodedByte(0x80 | (c & 0x3f));
      continue;
    }
    if (c < 0xd800 || c >= 0xe000) {
      lastPos = i + 1;
      out += percentEncodedByte(0xe0 | (c >> 12)) +
        percentEncodedByte(0x80 | ((c >> 6) & 0x3f)) +
        percentEncodedByte(0x80 | (c & 0x3f));
      continue;
    }
    // A surrogate pair, which is one code point in two units.
    ++i;
    if (i >= str.length) {
      throw new ERR_INVALID_URI();
    }
    const c2 = str.charCodeAt(i) & 0x3ff;
    lastPos = i + 1;
    c = 0x10000 + (((c & 0x3ff) << 10) | c2);
    out += percentEncodedByte(0xf0 | (c >> 18)) +
      percentEncodedByte(0x80 | ((c >> 12) & 0x3f)) +
      percentEncodedByte(0x80 | ((c >> 6) & 0x3f)) +
      percentEncodedByte(0x80 | (c & 0x3f));
  }
  if (lastPos === 0) return str;
  if (lastPos < str.length) return out + str.slice(lastPos);
  return out;
}

let urlParseWarned = false;

export function parse(
  url: string | Url,
  parseQueryString?: boolean,
  slashesDenoteHost?: boolean,
): Url {
  if (!urlParseWarned) {
    urlParseWarned = true;
    emitWarning(
      "`url.parse()` behavior is not standardized and prone to " +
        "errors that have security implications. Use the WHATWG URL API " +
        "instead. CVEs are not issued for `url.parse()` vulnerabilities.",
      "DeprecationWarning",
      "DEP0169",
    );
  }

  if (url instanceof Url) return url;

  const urlObject = new Url();
  urlObject.parse(url, parseQueryString, slashesDenoteHost);
  return urlObject;
}

/** The name the module uses internally, so the warning is not emitted twice. */
function urlParse(url: string | Url, parseQueryString?: boolean, slashesDenoteHost?: boolean): Url {
  // Already parsed: `resolve` and `resolveObject` accept either form.
  if (url instanceof Url) return url;
  const urlObject = new Url();
  urlObject.parse(url, parseQueryString, slashesDenoteHost);
  return urlObject;
}

export interface FormatOptions {
  fragment?: boolean;
  unicode?: boolean;
  search?: boolean;
  auth?: boolean;
}

export function format(
  urlObject: string | Url | URL | LegacyUrlLike,
  options?: FormatOptions,
): string {
  if (typeof urlObject === "string") {
    urlObject = urlParse(urlObject);
  } else if (typeof urlObject !== "object" || urlObject === null) {
    throw new ERR_INVALID_ARG_TYPE("urlObject", ["Object", "string"], urlObject);
  } else if (urlObject instanceof URL) {
    let fragment = true;
    let unicode = false;
    let search = true;
    let auth = true;

    if (options) {
      validateObject(options, "options");
      if (options.fragment != null) fragment = Boolean(options.fragment);
      if (options.unicode != null) unicode = Boolean(options.unicode);
      if (options.search != null) search = Boolean(options.search);
      if (options.auth != null) auth = Boolean(options.auth);
    }

    return formatWhatwg(urlObject, fragment, unicode, search, auth);
  }

  return formatLegacyUrl(urlObject);
}

/**
 * A `URL` serialised with parts left out, which the legacy `format` offers and
 * the class itself does not.
 */
function formatWhatwg(
  url: URL,
  fragment: boolean,
  unicode: boolean,
  search: boolean,
  auth: boolean,
): string {
  let out = `${url.protocol}//`;
  if (auth && (url.username !== "" || url.password !== "")) {
    out += url.username;
    if (url.password !== "") out += `:${url.password}`;
    out += "@";
  }
  const record = url.record();
  if (record.host === null) {
    // No host to serialise: fall back to the class's own form, which knows
    // how to write an opaque path.
    return url.href;
  }
  out += unicode ? domainToUnicodeHost(record.host) : record.host;
  if (record.port !== null) out += `:${record.port}`;
  out += url.pathname;
  if (search) out += url.search;
  if (fragment) out += url.hash;
  return out;
}

function domainToUnicodeHost(host: string): string {
  // Only a Punycode label has anything to decode; anything else comes back
  // unchanged, so this is safe to apply unconditionally.
  return host.startsWith("[") ? host : (domainToUnicode(host) || host);
}

export function resolve(source: string, relative: string): string {
  return urlParse(source, false, true).resolve(relative);
}

export function resolveObject(source: string | Url, relative: string | Url): string | Url {
  if (!source) return relative;
  return urlParse(source, false, true).resolveObject(relative);
}
