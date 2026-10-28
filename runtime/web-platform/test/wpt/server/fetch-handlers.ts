// Node-only, finite HTTP resources for the network Fetch WPT corpus.
// Reference sources: web-platform-tests/wpt at
// 2b38ea1cb920a2d0f91bf140d0e1eba73db8e742, fetch/api/resources/.
// The copied WPT cases and source-policy fixes follow after the pending stack.
import type { IncomingMessage, ServerResponse } from "node:http";
import { decodePercentBytes, readQueryBytes } from "./http-resources.ts";
import type { WptServerState } from "./state.ts";

const namespace = "/fetch/api/resources/";
const routes = new Set([
  "echo-content.py", "method.py", "status.py", "inspect-headers.py", "echo-header-bytes.py",
  "redirect.py", "redirect-empty-location.py", "clean-stash.py", "authentication.py", "dump-authorization-header.py",
].map((name) => namespace + name));

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(", ") : value;
}

function requiredQuery(url: URL, name: string): Buffer {
  const value = readQueryBytes(url, name);
  if (value === null) throw new Error("Missing WPT Fetch resource parameter: " + name);
  return value;
}

function integer(value: Buffer | null, fallback: number): number {
  if (value === null) return fallback;
  const text = value.toString("latin1");
  // Python int(bytes) accepts ASCII whitespace and digit separators, not a
  // Unicode trim or Node's high-bit-clearing ASCII decoder.
  const match = /^[\t\n\v\f\r ]*([+-]?[0-9](?:_?[0-9])*)[\t\n\v\f\r ]*$/.exec(text);
  if (match === null) throw new Error("Invalid WPT Fetch integer: " + text);
  const result = Number(match[1]!.replaceAll("_", ""));
  if (!Number.isSafeInteger(result)) throw new Error("WPT Fetch integer is outside the safe range");
  return result;
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function formValue(body: Buffer, name: string): Buffer | null {
  // A POST form has no URL fragment syntax. Decode its bytes directly, retaining
  // raw '#', malformed percent escapes and non-UTF-8 octets.
  const decode = (value: string): string => value.replace(/\+|%([0-9a-fA-F]{2})/g,
    (part: string, hex: string | undefined) => part === "+" ? " " : String.fromCharCode(Number.parseInt(hex!, 16)));
  for (const field of body.toString("latin1").split("&")) {
    const equals = field.indexOf("=");
    if (decode(equals === -1 ? field : field.slice(0, equals)) === name) {
      return Buffer.from(decode(equals === -1 ? "" : field.slice(equals + 1)), "latin1");
    }
  }
  return null;
}

function echoRequestHeaders(request: IncomingMessage, response: ServerResponse): void {
  response.setHeader("X-Request-Method", request.method ?? "GET");
  response.setHeader("X-Request-Content-Length", header(request, "content-length") ?? "NO");
  response.setHeader("X-Request-Content-Type", header(request, "content-type") ?? "NO");
}

function inspectHeaders(request: IncomingMessage, response: ServerResponse, url: URL): void {
  // WPT fetch/api/resources/inspect-headers.py.
  const checked = readQueryBytes(url, "headers")?.toString("latin1").split("|") ?? [];
  for (const name of checked) {
    const value = header(request, name);
    if (value !== undefined) response.appendHeader("x-request-" + name, value);
  }
  if (readQueryBytes(url, "cors") !== null) {
    response.setHeader("Access-Control-Allow-Origin", header(request, "origin") ?? "*");
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, HEAD");
    response.setHeader("Access-Control-Expose-Headers", checked.map((name) => "x-request-" + name).join(", "));
    const allowed = readQueryBytes(url, "allow_headers");
    response.setHeader("Access-Control-Allow-Headers", allowed === null
      ? Object.keys(request.headers).join(", ")
      : allowed.toString("latin1"));
  }
  response.setHeader("Content-Type", "text/plain");
  response.end();
}

interface RedirectState {
  count: number;
  preflight: string;
}

function redirectState(value: unknown): RedirectState {
  if (value === null) return { count: 0, preflight: "0" };
  if (typeof value !== "object" || value === null
    || !("count" in value) || typeof value.count !== "number"
    || !("preflight" in value) || typeof value.preflight !== "string") {
    throw new Error("Unexpected WPT Fetch redirect stash value");
  }
  return { count: value.count, preflight: value.preflight };
}

/** Python urlencode() quotes UTF-8 strings with spaces as '+' and leaves '~'. */
function formQuote(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    "%" + character.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g, "+");
}

/** WPT GET.items() gives the first value for each distinct byte-string key. */
function redirectQuery(url: URL): string {
  const parameters = new Map<string, string>();
  for (const field of url.search.slice(1).split("&")) {
    if (field === "") continue;
    const equals = field.indexOf("=");
    const key = decodePercentBytes(equals === -1 ? field : field.slice(0, equals)).toString("latin1");
    if (!parameters.has(key)) {
      parameters.set(key, decodePercentBytes(equals === -1 ? "" : field.slice(equals + 1)).toString("latin1"));
    }
  }
  return [...parameters].map(([key, value]) => formQuote(key) + "=" + formQuote(value)).join("&");
}

async function redirect(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  state: WptServerState,
): Promise<void> {
  // WPT fetch/api/resources/redirect.py. Delay-bearing modes need an injected
  // clock before they enter this deterministic server profile.
  const delay = readQueryBytes(url, "delay");
  if (delay !== null) {
    const value = delay.toString("latin1");
    if (!/^[\t\n\v\f\r ]*[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?[\t\n\v\f\r ]*$/.test(value)
      || Number(value) !== 0) {
      throw new Error("WPT Fetch redirect delay requires an injected clock");
    }
  }
  const token = readQueryBytes(url, "token")?.toString("latin1");
  const data = redirectState(token === undefined ? null : state.take(namespace, token));
  response.setHeader("Content-Type", "text/plain");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Pragma", "no-cache");
  const origin = header(request, "origin");
  response.setHeader("Access-Control-Allow-Origin", origin ?? "*");
  if (origin !== undefined) response.setHeader("Access-Control-Allow-Credentials", "true");
  if (request.method === "OPTIONS") {
    const allowed = readQueryBytes(url, "allow_headers");
    if (allowed !== null) response.setHeader("Access-Control-Allow-Headers", allowed.toString("latin1"));
    data.preflight = "1";
    if (readQueryBytes(url, "redirect_preflight") === null) {
      if (token) state.put(namespace, token, data);
      response.end();
      return;
    }
  }
  const body = await readBody(request);
  let status = readQueryBytes(url, "redirect_status");
  if (status === null) {
    const contentType = header(request, "content-type")?.split(";")[0]?.trim().toLowerCase();
    if (contentType === "application/x-www-form-urlencoded") status = formValue(body, "redirect_status");
    else if (contentType === "multipart/form-data") {
      throw new Error("WPT Fetch redirect multipart status requires multipart form parsing");
    }
  }
  response.statusCode = integer(status, 302);
  data.count++;
  const location = readQueryBytes(url, "location");
  if (location !== null) {
    let target = location.toString("latin1");
    if (readQueryBytes(url, "simple") === null) {
      const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(target)?.[1]?.toLowerCase() ?? "";
      if (scheme === "" || scheme === "http" || scheme === "https") {
        target += target.includes("?") ? "&" : "?";
        target += redirectQuery(url) + "&count=" + data.count;
      }
    }
    response.setHeader("Location", target);
  }
  const referrerPolicy = readQueryBytes(url, "redirect_referrerpolicy");
  if (referrerPolicy !== null) response.setHeader("Referrer-Policy", referrerPolicy.toString("latin1"));
  if (token) {
    state.put(namespace, token, data);
    const maximum = readQueryBytes(url, "max_count");
    if (maximum !== null && data.count > integer(maximum, 0)) {
      // Returning only a string in wptserve discards the pending redirect tuple.
      for (const name of response.getHeaderNames()) response.removeHeader(name);
      response.statusCode = 200;
      response.end(String(data.count - 1));
      return;
    }
  }
  response.end();
}

function authenticate(request: IncomingMessage, response: ServerResponse, url: URL): void {
  // WPT fetch/api/resources/authentication.py.
  const authorization = header(request, "authorization") ?? "";
  const basic = /^Basic\s+(.+)$/i.exec(authorization);
  if (basic !== null && Buffer.from(basic[1]!, "base64").toString("latin1") === "user:password") {
    response.end("Authentication done");
    return;
  }
  response.statusCode = 401;
  response.statusMessage = "Unauthorized";
  response.setHeader("WWW-Authenticate", 'Basic realm="' + (readQueryBytes(url, "realm")?.toString("latin1") ?? "test") + '"');
  response.end("Please login with credentials 'user' and 'password'");
}

function dumpAuthorization(request: IncomingMessage, response: ServerResponse, url: URL): void {
  // WPT fetch/api/resources/dump-authorization-header.py.
  response.setHeader("Content-Type", "text/html");
  response.setHeader("Cache-Control", "no-cache");
  if (readQueryBytes(url, "strip_auth_header")?.length && request.method === "OPTIONS"
    && (header(request, "access-control-request-headers") ?? "").toLowerCase().includes("authorization")) {
    response.statusCode = 500;
    response.end("fail");
    return;
  }
  const origin = header(request, "origin");
  response.setHeader("Access-Control-Allow-Origin", origin ?? "*");
  if (origin !== undefined) response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Allow-Headers", "Authorization");
  response.end(Buffer.from(header(request, "authorization") ?? "none", "latin1"));
}

/** Return false for resources owned by the existing server or not yet prepared. */
export async function handleFetchResource(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  state: WptServerState,
): Promise<boolean> {
  if (!routes.has(url.pathname)) return false;
  if (readQueryBytes(url, "pipe") !== null) {
    throw new Error("Unsupported WPT Fetch pipe modifier");
  }
  switch (url.pathname) {
    case "/fetch/api/resources/echo-content.py":
      // WPT fetch/api/resources/echo-content.py.
      echoRequestHeaders(request, response);
      response.setHeader("Content-Type", "text/plain");
      response.end(await readBody(request));
      return true;
    case "/fetch/api/resources/method.py":
      // WPT fetch/api/resources/method.py.
      if (readQueryBytes(url, "cors") !== null) {
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.setHeader("Access-Control-Allow-Credentials", "true");
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, FOO");
        response.setHeader("Access-Control-Allow-Headers", "x-test, x-foo");
        response.setHeader("Access-Control-Expose-Headers", "x-request-method");
      }
      echoRequestHeaders(request, response);
      for (const name of ["content-encoding", "content-language", "content-location"]) {
        response.setHeader("X-Request-" + name, header(request, name) ?? "NO");
      }
      response.end(await readBody(request));
      return true;
    case "/fetch/api/resources/status.py":
      // WPT fetch/api/resources/status.py.
      response.statusCode = integer(readQueryBytes(url, "code"), 200);
      response.statusMessage = readQueryBytes(url, "text")?.toString("latin1") ?? "OMG";
      response.setHeader("Content-Type", readQueryBytes(url, "type")?.toString("latin1") ?? "");
      response.setHeader("X-Request-Method", request.method ?? "GET");
      // An explicitly empty phrase is distinct from the default. Node's
      // implicit writeHead would replace the empty string with its status text.
      response.writeHead(response.statusCode, response.statusMessage);
      response.end(readQueryBytes(url, "content") ?? Buffer.alloc(0));
      return true;
    case "/fetch/api/resources/inspect-headers.py":
      inspectHeaders(request, response, url);
      return true;
    case "/fetch/api/resources/echo-header-bytes.py": {
      // WPT fetch/api/resources/echo-header-bytes.py.
      response.setHeader("Content-Type", "text/plain");
      const names = requiredQuery(url, "headers").toString("latin1").split("|");
      response.end(Buffer.from(names.map((name) => name + ": "
        + Buffer.from(header(request, name) ?? "", "latin1").toString("hex")).join("\n"), "latin1"));
      return true;
    }
    case "/fetch/api/resources/redirect.py":
      await redirect(request, response, url, state);
      return true;
    case "/fetch/api/resources/redirect-empty-location.py":
      // WPT fetch/api/resources/redirect-empty-location.py.
      response.statusCode = 302;
      response.setHeader("Location", "");
      response.end();
      return true;
    case "/fetch/api/resources/clean-stash.py":
      // WPT fetch/api/resources/clean-stash.py.
      response.end(state.take(namespace, requiredQuery(url, "token").toString("latin1")) === null ? "0" : "1");
      return true;
    case "/fetch/api/resources/authentication.py":
      authenticate(request, response, url);
      return true;
    case "/fetch/api/resources/dump-authorization-header.py":
      dumpAuthorization(request, response, url);
      return true;
    default:
      return false;
  }
}
