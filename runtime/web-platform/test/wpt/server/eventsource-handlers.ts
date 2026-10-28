// Node reproductions of eventsource/resources/*.py from the revision in
// upstream-manifest.json. The Python files remain the authority for these responses.
import type { IncomingMessage, ServerResponse } from "node:http";

/** Return false for resources served by the static-file or common-resource handler. */
export async function handleEventSource(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  switch (url.pathname) {
    case "/eventsource/resources/message.py":
      await message(response, url);
      break;
    case "/eventsource/resources/message2.py":
      await message2(response);
      break;
    case "/eventsource/resources/last-event-id.py":
      lastEventId(request, response, url);
      break;
    case "/eventsource/resources/last-event-id2.py":
      lastEventId2(response, url);
      break;
    case "/eventsource/resources/status-error.py":
      statusError(response, url);
      break;
    case "/eventsource/resources/status-reconnect.py":
      statusReconnect(request, response, url);
      break;
    case "/eventsource/resources/reconnect-fail.py":
      reconnectFail(request, response, url);
      break;
    case "/eventsource/resources/cors.py":
      await cors(request, response, url);
      break;
    case "/eventsource/resources/cors-cookie.py":
      corsCookie(request, response, url);
      break;
    default:
      return false;
  }
  return true;
}

// WPT: eventsource/resources/message.py.
async function message(response: ServerResponse, url: URL): Promise<void> {
  const mime = query(url, "mime") ?? Buffer.from("text/event-stream");
  const data = query(url, "message") ?? Buffer.from("data: data");
  const newline = query(url, "newline")?.toString("latin1") === "none" ? "" : "\n\n";
  const sleep = integer(query(url, "sleep"), 0);
  if (sleep !== 0 && !(await delay(response, sleep))) return;
  response.setHeader("Content-Type", mime.toString("latin1"));
  response.end(Buffer.concat([data, Buffer.from(newline + "\n")]));
}

// WPT: eventsource/resources/message2.py.
async function message2(response: ServerResponse): Promise<void> {
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.flushHeaders();
  const chunks = [
    "data:msg", "\n", "data: msg", "\n\n",
    ":", "\n",
    "falsefield:msg", "\n\n",
    "falsefield:msg", "\n", "Data:data", "\n\n",
    "data", "\n\n",
    "data:end", "\n\n",
  ];
  while (!response.destroyed && !response.writableEnded) {
    for (const chunk of chunks) {
      if (!(await write(response, chunk))) return;
    }
    if (!(await delay(response, 2000))) return;
  }
}

// WPT: eventsource/resources/last-event-id.py.
function lastEventId(request: IncomingMessage, response: ServerResponse, url: URL): void {
  response.setHeader("Content-Type", "text/event-stream");
  const last = Buffer.from(header(request, "last-event-id"), "latin1");
  if (last.length !== 0) {
    response.end(Buffer.concat([Buffer.from("data: "), last, Buffer.from("\n\n")]));
  } else {
    const id = query(url, "idvalue") ?? Buffer.from("\u2026");
    response.end(Buffer.concat([
      Buffer.from("id: "), id, Buffer.from("\nretry: 200\ndata: hello\n\n"),
    ]));
  }
}

// WPT: eventsource/resources/last-event-id2.py.
function lastEventId2(response: ServerResponse, url: URL): void {
  response.setHeader("Content-Type", "text/event-stream");
  let type = 1;
  try {
    type = integer(query(url, "type"), 1);
  } catch {
    // The upstream resource deliberately treats malformed integers as ID_PERSISTS.
  }
  switch (type) {
    case 1:
      response.end("id: 1\ndata: 1\n\ndata: 2\n\nid: 2\ndata:3\n\ndata:4\n\n");
      break;
    case 2:
      response.end("id: 1\ndata: 1\n\nid:\ndata:2\n\ndata:3\n\n");
      break;
    case 3:
      response.end("id: 1\ndata: 1\n\nid\ndata:2\n\ndata:3\n\n");
      break;
    default:
      response.end("data: invalid_test\n\n");
  }
}

// WPT: eventsource/resources/status-error.py.
function statusError(response: ServerResponse, url: URL): void {
  const status = integer(query(url, "status"), 404);
  response.statusCode = status;
  response.statusMessage = "HAHAHAHA";
  response.setHeader("Content-Type", "text/event-stream");
  response.end(status === 204 || status === 205 ? "" : "data: data\n\n");
}

// WPT: eventsource/resources/status-reconnect.py.
function statusReconnect(request: IncomingMessage, response: ServerResponse, url: URL): void {
  const status = query(url, "status") ?? Buffer.from("204");
  const name = "request" + (query(url, "id") ?? status).toString("latin1");
  response.setHeader("Content-Type", "text/event-stream");
  if (cookie(request, name) === status.toString("latin1")) {
    response.statusCode = 200;
    removeCookie(response, name);
    response.end("data: data\n\n");
  } else {
    setCookie(response, name, status.toString("latin1"));
    response.statusCode = integer(status, 204);
    response.statusMessage = "TEST";
    response.end("retry: 2\n" + (query(url, "ok_first") === undefined ? "" : "data: ok\n\n"));
  }
}

// WPT: eventsource/resources/reconnect-fail.py.
function reconnectFail(request: IncomingMessage, response: ServerResponse, url: URL): void {
  const name = "recon_fail_" + requiredQuery(url, "id").toString("latin1");
  const state = cookie(request, name);
  response.setHeader("Content-Type", "text/event-stream");
  if (state === "opened") {
    response.statusCode = 200;
    response.statusMessage = "RECONNECT";
    setCookie(response, name, "reconnected");
    response.end("data: reconnected\n\n");
  } else if (state === "reconnected") {
    response.statusCode = 204;
    response.statusMessage = "NO CONTENT (CLOSE)";
    removeCookie(response, name);
    // Node suppresses the body of a 204, as wptserve does.
    response.end("data: closed\n\n");
  } else {
    response.statusCode = 200;
    response.statusMessage = "OPEN";
    setCookie(response, name, "opened");
    response.end("retry: 2\ndata: opened\n\n");
  }
}

// WPT: eventsource/resources/cors.py, including its delegation to common/redirect.py.
async function cors(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const origin = query(url, "origin")?.toString("latin1") ?? header(request, "origin");
  const credentials = query(url, "credentials")?.toString("latin1") ?? "true";
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Credentials", credentials);
  switch (query(url, "run")?.toString("latin1")) {
    case "message":
      await message(response, url);
      break;
    case "status-reconnect":
      statusReconnect(request, response, url);
      break;
    case "cache-control":
      response.setHeader("Content-Type", "text/event-stream");
      response.end(Buffer.from("data: " + header(request, "cache-control") + "\n\n", "latin1"));
      break;
    case "redirect": {
      let status = 302;
      try {
        status = integer(query(url, "status"), 302);
      } catch {
        // common/redirect.py ignores an invalid status parameter.
      }
      response.statusCode = status;
      response.setHeader("Location", requiredQuery(url, "location").toString("latin1"));
      if (query(url, "enable-cors") !== undefined && header(request, "origin") !== "") {
        response.setHeader("Content-Type", "text/plain");
        response.setHeader("Access-Control-Allow-Origin", header(request, "origin"));
        response.setHeader("Access-Control-Allow-Credentials", "true");
      }
      response.end();
      break;
    }
    default:
      response.end();
  }
}

// WPT: eventsource/resources/cors-cookie.py.
function corsCookie(request: IncomingMessage, response: ServerResponse, url: URL): void {
  const last = header(request, "last-event-id");
  const ident = query(url, "ident")?.toString("latin1") ?? "test";
  const received = cookie(request, ident) === undefined ? "NO_COOKIE" : "COOKIE";
  const origin = query(url, "origin")?.toString("latin1") ?? header(request, "origin");
  const credentials = query(url, "credentials")?.toString("latin1") ?? "true";
  if (origin !== "none") response.setHeader("Access-Control-Allow-Origin", origin);
  if (credentials !== "none") response.setHeader("Access-Control-Allow-Credentials", credentials);
  if (last === "") {
    response.setHeader("Content-Type", "text/event-stream");
    setCookie(response, ident, "COOKIE");
    response.end("id: 1\nretry: 200\ndata: first " + received + "\n\n");
  } else if (last === "1") {
    response.setHeader("Content-Type", "text/event-stream");
    setCookie(response, ident, "COOKIE", "Fri, 27 Jul 2001 00:00:00 GMT");
    response.end("id: 2\ndata: second " + received + "\n\n");
  } else {
    response.setHeader("Content-Type", "stop");
    response.end(Buffer.from("data: " + last + received + "\n\n", "latin1"));
  }
}

/** WPT's request.GET contains decoded bytes, including deliberately invalid UTF-8. */
function query(url: URL, name: string): Buffer | undefined {
  for (const field of url.search.slice(1).split("&")) {
    const equals = field.indexOf("=");
    const key = equals < 0 ? field : field.slice(0, equals);
    if (decodeQueryBytes(key).toString("latin1") !== name) continue;
    return decodeQueryBytes(equals < 0 ? "" : field.slice(equals + 1));
  }
  return undefined;
}

function requiredQuery(url: URL, name: string): Buffer {
  const value = query(url, name);
  if (value === undefined) throw new TypeError("Missing WPT query parameter: " + name);
  return value;
}

function decodeQueryBytes(value: string): Buffer {
  const input = Buffer.from(value);
  const output = Buffer.allocUnsafe(input.length);
  let length = 0;
  for (let index = 0; index < input.length; index++) {
    const byte = input[index] ?? 0;
    if (byte === 37 && index + 2 < input.length) {
      const high = hex(input[index + 1] ?? 0);
      const low = hex(input[index + 2] ?? 0);
      if (high >= 0 && low >= 0) {
        output[length++] = high * 16 + low;
        index += 2;
        continue;
      }
    }
    output[length++] = byte === 43 ? 32 : byte;
  }
  return output.subarray(0, length);
}

function hex(byte: number): number {
  if (byte >= 48 && byte <= 57) return byte - 48;
  if (byte >= 65 && byte <= 70) return byte - 55;
  if (byte >= 97 && byte <= 102) return byte - 87;
  return -1;
}

function integer(value: Buffer | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const text = value.toString("latin1").trim();
  if (!/^[+-]?\d+$/.test(text)) throw new TypeError("Invalid WPT integer parameter");
  return Number(text);
}

function header(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  return Array.isArray(value) ? value.join(", ") : value ?? "";
}

function cookie(request: IncomingMessage, name: string): string | undefined {
  for (const item of header(request, "cookie").split(";")) {
    const equals = item.indexOf("=");
    if (equals < 0 || item.slice(0, equals).trim() !== name) continue;
    const value = item.slice(equals + 1).trim();
    return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  }
  return undefined;
}

function setCookie(response: ServerResponse, name: string, value: string, expires?: string): void {
  response.appendHeader("Set-Cookie", name + "=" + value + "; Path=/" +
    (expires === undefined ? "" : "; Expires=" + expires));
}

function removeCookie(response: ServerResponse, name: string): void {
  response.appendHeader("Set-Cookie", name + "=; Path=/; Max-Age=0");
}

/** Upstream delays control the resource; cancellation clears them without waiting. */
function delay(response: ServerResponse, milliseconds: number): Promise<boolean> {
  if (response.destroyed || response.writableEnded) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (live: boolean): void => {
      clearTimeout(timer);
      response.off("close", closed);
      resolve(live);
    };
    const closed = (): void => finish(false);
    const timer = setTimeout(() => finish(true), milliseconds);
    response.once("close", closed);
  });
}

function write(response: ServerResponse, chunk: string): Promise<boolean> {
  if (response.destroyed || response.writableEnded) return Promise.resolve(false);
  return new Promise((resolve) => {
    const closed = (): void => resolve(false);
    response.once("close", closed);
    response.write(chunk, (error?: Error | null) => {
      response.off("close", closed);
      resolve(!error && !response.destroyed);
    });
  });
}
