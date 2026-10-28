// Node-only implementations of the WPT HTTP resources used by the realtime suites.
// The source paths below refer to unedited files pinned in upstream-manifest.json.
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WptServerState } from "./state.ts";

/** Decode form values as bytes, preserving deliberately malformed UTF-8 fixtures. */
export function decodePercentBytes(value: string, form = true): Buffer {
  const source = Buffer.from(value);
  const result = Buffer.allocUnsafe(source.length);
  let length = 0;
  for (let index = 0; index < source.length; index++) {
    const byte = source[index]!;
    if (byte === 37 && index + 2 < source.length) {
      const high = hexDigit(source[index + 1]!);
      const low = hexDigit(source[index + 2]!);
      if (high !== -1 && low !== -1) {
        result[length++] = high * 16 + low;
        index += 2;
        continue;
      }
    }
    result[length++] = form && byte === 43 ? 32 : byte;
  }
  return result.subarray(0, length);
}

function hexDigit(byte: number): number {
  if (byte >= 48 && byte <= 57) return byte - 48;
  if (byte >= 65 && byte <= 70) return byte - 55;
  if (byte >= 97 && byte <= 102) return byte - 87;
  return -1;
}

/** Like wptserve request.GET.first(), without a UTF-8 decoding round trip. */
export function readQueryBytes(url: URL, name: string): Buffer | null {
  for (const field of url.search.slice(1).split("&")) {
    const equals = field.indexOf("=");
    const key = equals === -1 ? field : field.slice(0, equals);
    if (decodePercentBytes(key).toString("latin1") !== name) continue;
    return decodePercentBytes(equals === -1 ? "" : field.slice(equals + 1));
  }
  return null;
}

function requireQueryBytes(url: URL, name: string): Buffer {
  const value = readQueryBytes(url, name);
  if (value === null) throw new Error("Missing WPT resource parameter: " + name);
  return value;
}

function firstHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** A fixture delay ends when the client goes away, including during server cleanup. */
async function delay(response: ServerResponse, milliseconds: number): Promise<boolean> {
  if (response.destroyed) return false;
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => finish(true), milliseconds);
    const closed = (): void => finish(false);
    function finish(completed: boolean): void {
      clearTimeout(timer);
      response.off("close", closed);
      resolve(completed);
    }
    response.once("close", closed);
  });
}

async function writeChunk(response: ServerResponse, chunk: Buffer): Promise<boolean> {
  if (response.destroyed) return false;
  if (response.write(chunk)) return true;
  return new Promise<boolean>((resolve, reject) => {
    const drained = (): void => finish(true);
    const closed = (): void => finish(false);
    const failed = (error: Error): void => {
      cleanup();
      reject(error);
    };
    function cleanup(): void {
      response.off("drain", drained);
      response.off("close", closed);
      response.off("error", failed);
    }
    function finish(completed: boolean): void {
      cleanup();
      resolve(completed);
    }
    response.once("drain", drained);
    response.once("close", closed);
    response.once("error", failed);
  });
}

function integerOr(value: Buffer | null, fallback: number): number {
  if (value === null) return fallback;
  const text = value.toString("ascii").trim();
  return /^[+-]?\d+$/.test(text) ? Number(text) : fallback;
}

function writeRedirect(request: IncomingMessage, response: ServerResponse, url: URL): void {
  // WPT common/redirect.py: preserve Location bytes and echo CORS only when requested.
  response.statusCode = integerOr(readQueryBytes(url, "status"), 302);
  response.setHeader("Location", requireQueryBytes(url, "location").toString("latin1"));
  if (readQueryBytes(url, "enable-cors") !== null) {
    const origin = firstHeader(request, "origin");
    if (origin !== undefined && origin !== "") {
      response.setHeader("Content-Type", "text/plain");
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Access-Control-Allow-Credentials", "true");
    }
  }
  response.end();
}

function putStash(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  state: WptServerState,
): void {
  // WPT fetch/api/resources/stash-put.py. Its namespace is the URL directory.
  if (request.method === "OPTIONS") {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "*");
    response.setHeader("Access-Control-Allow-Headers", "*");
    response.end("done");
    return;
  }
  if (readQueryBytes(url, "disallow_cross_origin") === null) {
    response.setHeader("Access-Control-Allow-Origin", "*");
  } else if (readQueryBytes(url, "mode")?.toString("latin1") !== "no-cors") {
    // Keep the upstream assertion's spelling, including its trailing space.
    if (readQueryBytes(url, "frame_origin ") === null) {
      throw new Error("WPT stash-put requires frame_origin ");
    }
    const frameOrigin = requireQueryBytes(url, "frame_origin").toString("utf8");
    if (frameOrigin !== url.origin) {
      response.end("not stashing for cors request");
      return;
    }
  }
  state.put(
    "/fetch/api/resources/",
    requireQueryBytes(url, "key").toString("latin1"),
    requireQueryBytes(url, "value").toString("latin1"),
  );
  response.end("done");
}

async function chunkedContent(response: ServerResponse, url: URL): Promise<void> {
  // WPT xhr/resources/content-in-chunks.py. Each chunk is hex, not UTF-8 text.
  const chunks: Buffer[] = [];
  for (const raw of url.searchParams.getAll("chunk")) {
    const hex = raw.replace(/[\t\n\v\f\r ]/g, "");
    if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) throw new Error("Invalid WPT hex chunk");
    chunks.push(Buffer.from(hex, "hex"));
  }
  const milliseconds = Number(readQueryBytes(url, "ms")?.toString("ascii") ?? "100");
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new Error("Invalid WPT chunk delay");
  }
  response.setHeader("Content-Type", readQueryBytes(url, "type")?.toString("latin1") ?? "text/plain");
  response.setHeader("Transfer-Encoding", "chunked");
  response.flushHeaders();
  for (const chunk of chunks) {
    if (!(await delay(response, milliseconds))) return;
    if (!(await writeChunk(response, chunk))) return;
  }
  response.end();
}

/** Return false for a static resource or a route this server does not implement. */
export async function handleHttpResource(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  state: WptServerState,
): Promise<boolean> {
  switch (url.pathname) {
    case "/common/redirect.py":
      writeRedirect(request, response, url);
      return true;
    case "/common/blank.html": {
      // WPT wptserve's pipe=trickle(d1/d2), used by WebSocket sync-XHR cases.
      const match = /^trickle\(d([0-9]+(?:\.[0-9]+)?)\)$/.exec(url.searchParams.get("pipe") ?? "");
      if (match === null) return false;
      response.setHeader("Content-Type", "text/html");
      response.flushHeaders();
      if (await delay(response, Number(match[1]) * 1000)) response.end();
      return true;
    }
    case "/xhr/resources/content-in-chunks.py":
      await chunkedContent(response, url);
      return true;
    case "/fetch/api/resources/stash-put.py":
      putStash(request, response, url, state);
      return true;
    case "/fetch/api/resources/stash-take.py":
      // WPT fetch/api/resources/stash-take.py: take consumes the value; absent is null.
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(state.take("/fetch/api/resources/", requireQueryBytes(url, "key").toString("latin1"))));
      return true;
    case "/websockets/opening-handshake/resources/redirect_response.py":
      // WPT websockets/opening-handshake/resources/redirect_response.py.
      response.statusCode = 301;
      response.statusMessage = "moved";
      response.setHeader("Location", "/echo");
      response.end();
      return true;
    case "/websockets/security/check.py":
      // WPT websockets/security/check.py.
      response.end(firstHeader(request, "sec-websocket-key") === undefined ? "PASS" : "FAIL");
      return true;
    case "/websockets/cookies/support/set-cookie.py":
      // WPT websockets/cookies/support/set-cookie.py uses unquote(), not unquote_plus().
      response.setHeader("Set-Cookie", decodePercentBytes(url.search.slice(1), false).toString("utf8"));
      response.setHeader("Content-Type", "text/plain");
      response.end();
      return true;
    case "/websockets/resources/accept-handshake.py": {
      // WPT websockets/resources/accept-handshake.py leaves the upgraded socket open.
      const key = firstHeader(request, "sec-websocket-key");
      if (key === undefined) throw new Error("WPT accept-handshake requires Sec-WebSocket-Key");
      const accept = createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");
      response.writeHead(101, "Switching Protocols", {
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Accept": accept,
      });
      response.flushHeaders();
      return true;
    }
    default:
      return false;
  }
}
