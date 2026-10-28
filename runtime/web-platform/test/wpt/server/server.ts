// Node-only WPT resources. No Python, external server, testharness shim or global
// Web API replacement is part of this module.
import { readFile, realpath } from "node:fs/promises";
import { createServer, ServerResponse } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { Socket } from "node:net";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { handleEventSource } from "./eventsource-handlers.ts";
import { handleHttpResource } from "./http-resources.ts";
import { WptWebSocketPeer } from "./peer.ts";
import { WptServerState } from "./state.ts";
import { substitute } from "./substitutions.ts";
import type { WptPorts } from "./substitutions.ts";
import { handleWebSocket } from "./websocket-handlers.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const types: Readonly<Record<string, string>> = {
  ".js": "text/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".event_stream": "text/event-stream",
  ".pac": "application/x-ns-proxy-autoconfig",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export interface WptServer {
  readonly ports: WptPorts;
  readonly httpOrigin: string;
  readonly httpsOrigin: string;
  readonly wsOrigin: string;
  readonly wssOrigin: string;
  /** Trust only for these tests. The upstream CA is never installed globally. */
  readonly ca: string;
  /** Unexpected handler errors remain observable to the enclosing Node test. */
  readonly errors: readonly unknown[];
  readonly state: WptServerState;
  close(): Promise<void>;
}

function requestURL(request: IncomingMessage, secure: boolean): URL {
  return new URL(request.url ?? "/", `${secure ? "https" : "http"}://${request.headers.host ?? "web-platform.test"}`);
}

async function serveStatic(request: IncomingMessage, response: ServerResponse, url: URL, ports: WptPorts): Promise<void> {
  let path: string;
  try { path = decodeURIComponent(url.pathname); }
  catch { response.writeHead(404).end(); return; }
  const type = types[extname(path)];
  // The Python references and certificates are provenance, not public resources.
  if (type === undefined || path.includes("\0") || path.includes("\\")) {
    response.writeHead(404).end();
    return;
  }
  let file: string;
  let bytes: Buffer;
  try {
    file = await realpath(resolve(root, "." + path));
    const inside = relative(root, file);
    if (inside === ".." || inside.startsWith(".." + sep)) {
      response.writeHead(404).end();
      return;
    }
    bytes = await readFile(file);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      response.writeHead(404).end();
      return;
    }
    throw error;
  }
  const substitutions = { host: url.hostname, ports, headers: request.headers };
  if (path.includes(".sub.") || url.searchParams.get("pipe") === "sub") {
    bytes = Buffer.from(substitute(bytes.toString("utf8"), substitutions));
  }
  response.setHeader("Content-Type", type);
  try {
    const headers = substitute(await readFile(file + ".headers", "utf8"), substitutions);
    for (const line of headers.split(/\r?\n/)) {
      const colon = line.indexOf(":");
      if (colon > 0) response.appendHeader(line.slice(0, colon), line.slice(colon + 1).trim());
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  response.end(bytes);
}

function listen(server: Server): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const failed = (error: Error): void => { server.off("listening", ready); reject(error); };
    const ready = (): void => {
      server.off("error", failed);
      const address = server.address();
      if (address === null || typeof address === "string") reject(new Error("WPT server did not bind TCP"));
      else resolvePort(address.port);
    };
    server.once("error", failed);
    server.once("listening", ready);
    server.listen(0, "127.0.0.1");
  });
}

/** Four ephemeral listeners allow the corpus's same-host, different-port cases. */
export async function startWptServer(): Promise<WptServer> {
  const [key, cert, ca] = await Promise.all([
    readFile(new URL("../tools/certs/web-platform.test.key", import.meta.url)),
    readFile(new URL("../tools/certs/web-platform.test.pem", import.meta.url)),
    readFile(new URL("../tools/certs/cacert.pem", import.meta.url), "utf8"),
  ]);
  const sockets = new Set<Socket>();
  const pending = new Set<Promise<void>>();
  const errors: unknown[] = [];
  const state = new WptServerState();
  const httpPorts: number[] = [];
  const httpsPorts: number[] = [];
  const ports: WptPorts = { http: httpPorts, https: httpsPorts, ws: httpPorts, wss: httpsPorts };
  let closing: Promise<void> | null = null;

  const track = (operation: Promise<void>, failed: (error: unknown) => void): void => {
    const settled = operation.catch(failed).finally(() => pending.delete(settled));
    pending.add(settled);
  };
  const dispatch = async (request: IncomingMessage, response: ServerResponse, secure: boolean): Promise<void> => {
    let url: URL;
    try { url = requestURL(request, secure); }
    catch { response.writeHead(400).end(); return; }
    if (await handleEventSource(request, response, url)) return;
    if (await handleHttpResource(request, response, url, state)) return;
    await serveStatic(request, response, url, ports);
  };
  const handle = (request: IncomingMessage, response: ServerResponse, secure: boolean): void => {
    track(dispatch(request, response, secure), (error) => {
      if (closing !== null || response.destroyed) return;
      errors.push(error);
      if (response.headersSent) response.destroy();
      else response.writeHead(500).end("WPT resource failed");
    });
  };
  const servers: Server[] = [
    createServer((request, response) => handle(request, response, false)),
    createServer((request, response) => handle(request, response, false)),
    createSecureServer({ key, cert, ALPNProtocols: ["http/1.1"] }, (request, response) => handle(request, response, true)),
    createSecureServer({ key, cert, ALPNProtocols: ["http/1.1"] }, (request, response) => handle(request, response, true)),
  ];
  for (const [index, server] of servers.entries()) {
    // Upstream long/reconnection tests own the deadline. Node's HTTP request
    // timeout must not end their resource while other gate jobs are running.
    server.requestTimeout = 0;
    server.on("connection", (socket: Socket) => {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.once("close", () => sockets.delete(socket));
    });
    server.on("upgrade", (request, socket, head) => {
      if (!(socket instanceof Socket)) { socket.destroy(); return; }
      let url: URL;
      try { url = requestURL(request, index >= 2); }
      catch { socket.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n"); return; }
      if (url.pathname.endsWith(".py")) {
        // abort.any.js uses a stash-put URL as its forbidden handshake target.
        // The resource must observe the request even when it is an Upgrade.
        const response = new ServerResponse(request);
        response.assignSocket(socket);
        handle(request, response, index >= 2);
        response.once("finish", () => socket.end());
        return;
      }
      const peer = new WptWebSocketPeer(request, socket, head, index >= 2);
      const upgraded = async (): Promise<void> => {
        if (await peer.validateHandshake()) await handleWebSocket(peer, state);
      };
      track(upgraded(), (error) => {
        if (closing === null && !peer.signal.aborted && !socket.destroyed && !socket.readableEnded) errors.push(error);
        socket.destroy();
      });
    });
  }
  const close = (): Promise<void> => {
    if (closing !== null) return closing;
    closing = (async () => {
      const stopped = servers.map((server) => new Promise<void>((done) => {
        if (!server.listening) { done(); return; }
        server.close(() => done());
      }));
      for (const socket of sockets) socket.destroy();
      state.close();
      await Promise.all(stopped);
      await Promise.all(pending);
    })();
    return closing;
  };
  try {
    for (const [index, server] of servers.entries()) {
      (index < 2 ? httpPorts : httpsPorts).push(await listen(server));
    }
  } catch (error) {
    await close();
    throw error;
  }
  return {
    ports, ca, errors, state, close,
    httpOrigin: `http://web-platform.test:${httpPorts[0]}`,
    httpsOrigin: `https://web-platform.test:${httpsPorts[0]}`,
    wsOrigin: `ws://web-platform.test:${httpPorts[0]}`,
    wssOrigin: `wss://web-platform.test:${httpsPorts[0]}`,
  };
}
