// Server controls for the unchanged WPT resources. These are not WPT case counts:
// the shared testharness adapter imports the API corpora in subsequent PRs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import test from "node:test";
import type { TestContext } from "node:test";
import { startWptServer } from "./wpt/server/server.ts";
import type { WptServer } from "./wpt/server/server.ts";
import { WptServerState } from "./wpt/server/state.ts";
import { substitute } from "./wpt/server/substitutions.ts";
import { readWptVersions, verifiedWptSource } from "./wpt/versions.ts";
import { createWptRuntime } from "./wpt/server/runtime.ts";
import { AbortController as PlatformAbortController, WebSocket } from "../src/index.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, fn);
};

interface Result {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

async function serverFor(t: TestContext): Promise<WptServer> {
  const server = await startWptServer();
  t.after(async () => {
    await server.close();
    assert.deepEqual(server.errors, [], "server handlers must not fail silently");
  });
  return server;
}

function request(
  server: WptServer,
  path: string,
  headers: Record<string, string> = {},
  secure = false,
  index = 0,
  servername = "web-platform.test",
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const port = (secure ? server.ports.https : server.ports.http)[index];
    const req = (secure ? httpsRequest : httpRequest)({
      hostname: "127.0.0.1", port, path, ca: server.ca, servername,
      headers: { Host: `${servername}:${port}`, ...headers },
      agent: false,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.once("error", reject);
    req.end();
  });
}

suite("the WPT support sources and certificates match their pinned upstream hashes", async () => {
  interface Manifest { files: { source: string; local: string }[] }
  const root = new URL("./wpt/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("server/upstream-manifest.json", root), "utf8")) as Manifest;
  const versions = readWptVersions(root);
  assert.equal(manifest.files.length, 75, "the complete item-1 support inventory is checked");
  const paths = new Set<string>();
  for (const file of manifest.files) {
    assert.equal(paths.has(file.local), false, "duplicate manifest path: " + file.local);
    paths.add(file.local);
    assert.equal(versions.files[file.local]?.source ?? file.local, file.source);
    verifiedWptSource(root, file.local, versions);
  }
  const handlers = (await Promise.all(["websocket-handlers.ts", "eventsource-handlers.ts", "http-resources.ts"]
    .map((path) => readFile(new URL("server/" + path, root), "utf8")))).join("\n");
  for (const file of manifest.files.filter((file) => file.source.endsWith(".py"))) {
    assert.ok(handlers.includes(file.source), "a reproduction must name its source: " + file.source);
  }
});

suite("WPT substitutions use each listener's ports and preserve distinct origins", async (t) => {
  const server = await serverFor(t);
  assert.equal(new Set([...server.ports.http, ...server.ports.https]).size, 4);
  for (const secure of [false, true]) {
    for (const index of [0, 1]) {
      const constants = await request(server, "/websockets/constants.sub.js", {}, secure, index);
      assert.equal(constants.status, 200);
      const source = constants.body.toString("utf8");
      assert.equal(source.includes("{{"), false);
      assert.ok(source.includes("web-platform.test"));
      assert.ok(source.includes(String(server.ports.ws[0])));
      assert.ok(source.includes(String(server.ports.wss[0])));
    }
  }
  const hosts = await request(server, "/common/get-host-info.sub.js");
  const source = hosts.body.toString("utf8");
  assert.equal(source.includes("{{"), false);
  assert.ok(source.includes("www2.web-platform.test"));
  assert.ok(source.includes("not-web-platform.test"));
  assert.ok(source.includes(String(server.ports.http[1])));
  assert.ok(source.includes(String(server.ports.https[1])));
  assert.throws(() => substitute("{{unimplemented}}", { host: "web-platform.test", ports: server.ports }), /Unsupported/);
  assert.throws(() => substitute("{{ports[ws][9]}}", { host: "web-platform.test", ports: server.ports }), /Unavailable/);
});

suite("the WPT TLS listener verifies its original certificate and hostname", async (t) => {
  const server = await serverFor(t);
  const response = await request(server, "/common/blank.html", {}, true);
  assert.equal(response.status, 200);
  await assert.rejects(request(server, "/common/blank.html", {}, true, 0, "localhost"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "ERR_TLS_CERT_ALTNAME_INVALID");
});

suite("event-stream pipe substitutions echo actual request headers", async (t) => {
  const server = await serverFor(t);
  for (const [resource, header, value] of [
    ["accept", "Accept", "text/event-stream"],
    ["cache-control", "Cache-Control", "no-cache"],
  ] as const) {
    const response = await request(server, `/eventsource/resources/${resource}.event_stream?pipe=sub`, { [header]: value });
    assert.equal(response.status, 200);
    assert.equal(response.headers["content-type"], "text/event-stream");
    assert.equal(response.body.toString("utf8"), `data: ${value}\n\n`);
  }
});

suite("static serving honors media types and rejects unpublished or escaping paths", async (t) => {
  const server = await serverFor(t);
  const script = await request(server, "/common/utils.js");
  assert.equal(script.status, 200);
  assert.match(String(script.headers["content-type"]), /text\/javascript/);
  const upstream = await readFile(new URL("./wpt/common/utils.js", import.meta.url));
  assert.deepEqual(script.body, upstream);
  for (const path of ["/server/peer.ts", "/tools/certs/cacert.key", "/eventsource/resources/unknown.py", "/%2e%2e/%2e%2e/README.md", "/common/..%2f..%2fserver.ts", "/%FF.js"]) {
    assert.equal((await request(server, path)).status, 404, path);
  }
});

suite("the peer rejects malformed client handshakes before running a WPT handler", async (t) => {
  const server = await serverFor(t);
  const headers = { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "13" };
  assert.equal((await request(server, "/echo", { ...headers, "Sec-WebSocket-Key": "wrong" })).status, 400);
  assert.equal((await request(server, "/echo", { ...headers, "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZR==" })).status, 400, "base64 padding bits must be zero");
  assert.equal((await request(server, "/echo", { ...headers, "Sec-WebSocket-Version": "" })).status, 400);
  const version = await request(server, "/echo", { ...headers, "Sec-WebSocket-Version": "12" });
  assert.equal(version.status, 426);
  assert.equal(version.headers["sec-websocket-version"], "13");
  assert.equal((await request(server, "/echo", { ...headers, Host: "[" })).status, 400);
});

suite("the common redirect resource preserves status, target bytes and optional CORS", async (t) => {
  const server = await serverFor(t);
  const response = await request(server, "/common/redirect.py?status=307&location=%2Feventsource%2Fresources%2Fmessage.py%3Fx%3D%252B&enable-cors", { Origin: server.httpOrigin });
  assert.equal(response.status, 307);
  assert.equal(response.headers.location, "/eventsource/resources/message.py?x=%2B");
  assert.equal(response.headers["access-control-allow-origin"], server.httpOrigin);
  assert.equal(response.headers["access-control-allow-credentials"], "true");
  const fallback = await request(server, "/common/redirect.py?status=invalid&location=%2F");
  assert.equal(fallback.status, 302);
  assert.equal(fallback.headers["access-control-allow-origin"], undefined);
  const websocket = await request(server, "/websockets/opening-handshake/resources/redirect_response.py");
  assert.equal(websocket.status, 301);
  assert.equal(websocket.headers.location, "/echo");
});

suite("HTTP stash resources consume values and stay isolated between server instances", async (t) => {
  const first = await serverFor(t);
  const second = await serverFor(t);
  for (const [server, value] of [[first, "one"], [second, "two"]] as const) {
    assert.equal((await request(server, `/fetch/api/resources/stash-put.py?key=same&value=${value}`)).body.toString(), "done");
  }
  for (const [server, value] of [[first, "one"], [second, "two"]] as const) {
    assert.equal(JSON.parse((await request(server, "/fetch/api/resources/stash-take.py?key=same")).body.toString()), value);
    assert.equal(JSON.parse((await request(server, "/fetch/api/resources/stash-take.py?key=same")).body.toString()), null);
  }
});

suite("an unwanted Upgrade still reaches the stream-abort test's HTTP stash resource", async (t) => {
  const server = await serverFor(t);
  const response = await request(server, "/fetch/api/resources/stash-put.py?key=abort-probe&value=connected", {
    Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13",
    "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
  });
  assert.equal(response.status, 200);
  const stashed = await request(server, "/fetch/api/resources/stash-take.py?key=abort-probe");
  assert.equal(JSON.parse(stashed.body.toString()), "connected", "a wrong connect must make abort.any.js fail");
});

suite("the HTTP accept-handshake resource writes the RFC accept and leaves an upgraded connection", async (t) => {
  const server = await serverFor(t);
  await new Promise<void>((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port: server.ports.http[0], path: "/websockets/resources/accept-handshake.py", agent: false,
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==" },
    });
    req.once("error", reject);
    req.once("response", () => reject(new Error("The server did not upgrade")));
    req.once("upgrade", (response, socket, head) => {
      try {
        assert.equal(response.statusCode, 101);
        assert.equal(response.headers["sec-websocket-accept"], "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
        assert.equal(head.length, 0);
        assert.equal(socket.destroyed, false);
        resolve();
      } catch (error) { reject(error); }
      finally { socket.destroy(); }
    });
    req.end();
  });
});

suite("blocked-port routing reaches a live peer when the runtime policy is bypassed", async (t) => {
  const server = await serverFor(t);
  const runtime = createWptRuntime(server);
  t.after(() => runtime.close());
  const url = "ws://bad-port-25.wpt:25/websockets/resources/accept-handshake.py";
  // The transport bypasses the public API's port check. A local routing failure
  // must not be mistaken for a successful blocked-port policy test.
  const session = await runtime.transport.connect({
    url: runtime.urls.parse(url), protocols: [], origin: server.httpOrigin,
  }, new PlatformAbortController().signal);
  session.abort();
  const socket = new WebSocket(url);
  t.after(() => socket.close());
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => reject(new Error("The API accepted a prohibited logical port"));
    socket.onclose = (event) => {
      try {
        assert.equal(event.code, 1006);
        assert.equal(event.wasClean, false);
        resolve();
      } catch (error) { reject(error); }
    };
  });
});

suite("HTTP cookie and security resources preserve the upstream distinctions", async (t) => {
  const server = await serverFor(t);
  assert.equal((await request(server, "/websockets/security/check.py")).body.toString(), "PASS");
  assert.equal((await request(server, "/websockets/security/check.py", { "Sec-WebSocket-Key": "test" })).body.toString(), "FAIL");
  const cookie = await request(server, "/websockets/cookies/support/set-cookie.py?name=a+b%20c%3BPath%3D%2F");
  assert.deepEqual(cookie.headers["set-cookie"], ["name=a+b c;Path=/"]);
});

suite("chunk resources preserve split BOM bytes and stop on EOF", async (t) => {
  const server = await serverFor(t);
  const response = await request(server, "/xhr/resources/content-in-chunks.py?ms=0&type=text/event-stream&chunk=ef&chunk=bb&chunk=bf646174613a20e282ac0a0a");
  assert.equal(response.headers["content-type"], "text/event-stream");
  assert.equal(response.headers["transfer-encoding"], "chunked");
  assert.deepEqual(response.body, Buffer.from("efbbbf646174613a20e282ac0a0a", "hex"));
});

suite("blocking stash reads consume one value and cancel without leaving a waiter", async () => {
  const state = new WptServerState();
  const cancelled = new AbortController();
  const first = state.wait("/path", "key", cancelled.signal);
  const rejected = assert.rejects(first, /cancelled/);
  cancelled.abort(new Error("cancelled"));
  await rejected;
  const second = state.wait("/path", "key");
  state.put("/path", "key", { answer: 42 });
  assert.deepEqual(await second, { answer: 42 });
  assert.equal(state.take("/path", "key"), null);
  state.put("/path", "key", "queued");
  assert.throws(() => state.put("/path", "key", "duplicate"), /Duplicate/);
  assert.equal(await state.wait("/path", "key"), "queued");
  const waiting = assert.rejects(state.wait("/path", "pending"), /closed/);
  state.close();
  await waiting;
});

suite("closing the server cancels a delayed resource and is idempotent", async (t) => {
  const server = await serverFor(t);
  const req = httpRequest({ hostname: "127.0.0.1", port: server.ports.http[0], path: "/xhr/resources/content-in-chunks.py?ms=60000&chunk=01", agent: false });
  req.on("error", () => {});
  t.after(() => req.destroy());
  const received = new Promise<void>((resolve) => req.once("response", (response) => {
    response.on("error", () => {});
    response.resume();
    resolve();
  }));
  req.end();
  await received;
  const closed = server.close();
  assert.equal(server.close(), closed);
  await closed;
});
