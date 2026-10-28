// Contracts for the Node reproductions of WPT's EventSource resources. These
// focused tests are server evidence; running upstream cases needs the shared
// WPT adapter. Every EventSource below is the package's public class.
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";
import test from "node:test";
import type { TestContext } from "node:test";
import { CookieJar, EventSource, EventTarget, MessageEvent, ServerCookiePolicy } from "../src/index.ts";
import { hostNodeURLs } from "../host/node-primitives.ts";
import type { WebPlatformOptions, WebPlatformRuntime } from "../src/provider.ts";
import { createWptRuntime } from "./wpt/server/runtime.ts";
import { startWptServer } from "./wpt/server/server.ts";
import type { WptServer } from "./wpt/server/server.ts";

interface ResourceResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

const suite = (name: string, run: (t: TestContext) => Promise<void>): void => {
  test(name, { timeout: 60_000 }, run);
};

async function serverFor(t: TestContext): Promise<WptServer> {
  const server = await startWptServer();
  t.after(async () => {
    await server.close();
    assert.deepEqual(server.errors, [], "the resource server recorded an unexpected failure");
  });
  return server;
}

function runtimeFor(
  t: TestContext,
  server: WptServer,
  options: WebPlatformOptions = {},
): WebPlatformRuntime {
  const runtime = createWptRuntime(server, options);
  t.after(() => runtime.close());
  return runtime;
}

function resource(
  server: WptServer,
  path: string,
  headers: OutgoingHttpHeaders = {},
): Promise<ResourceResponse> {
  const port = server.ports.http[0];
  assert.ok(port !== undefined, "the first HTTP listener exists");
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => resolve({
        status: response.statusCode ?? 0,
        statusText: response.statusMessage ?? "",
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    request.once("error", reject);
    request.end();
  });
}

function messages(source: EventSource, count: number): Promise<MessageEvent<string>[]> {
  const result = Promise.withResolvers<MessageEvent<string>[]>();
  const received: MessageEvent<string>[] = [];
  source.onmessage = (event) => {
    received.push(event);
    if (received.length !== count) return;
    source.close();
    result.resolve(received);
  };
  source.onerror = () => {
    source.close();
    result.reject(new Error("EventSource failed before receiving its expected messages"));
  };
  return result.promise;
}

suite("WPT message.py preserves percent-decoded bytes and the requested final newline", async (t) => {
  const server = await serverFor(t);
  const defaults = await resource(server, "/eventsource/resources/message.py");
  assert.equal(defaults.headers["content-type"], "text/event-stream");
  assert.equal(defaults.body.toString(), "data: data\n\n\n");

  const bytes = await resource(server,
    "/eventsource/resources/message.py?message=%EF%BB%BFdata%3A%FF%00%2B+&newline=none" +
    "&mime=text/event-stream%3Bcharset=windows-1252");
  assert.equal(bytes.headers["content-type"], "text/event-stream;charset=windows-1252");
  assert.deepEqual(bytes.body, Buffer.from([
    0xef, 0xbb, 0xbf, 0x64, 0x61, 0x74, 0x61, 0x3a, 0xff, 0, 0x2b, 0x20, 0x0a,
  ]));

  const first = await resource(server, "/eventsource/resources/message.py?message=first&message=second");
  assert.equal(first.body.toString(), "first\n\n\n", "wptserve uses the first query value");
});

suite("WPT last-event-id resources preserve header bytes and all reset variants", async (t) => {
  const server = await serverFor(t);
  const first = await resource(server, "/eventsource/resources/last-event-id.py?idvalue=%FF%00");
  assert.deepEqual(first.body, Buffer.concat([
    Buffer.from("id: "), Buffer.from([0xff, 0]), Buffer.from("\nretry: 200\ndata: hello\n\n"),
  ]));
  const repeated = await resource(server, "/eventsource/resources/last-event-id.py", {
    "Last-Event-ID": Buffer.from("\u2026").toString("latin1"),
  });
  assert.deepEqual(repeated.body, Buffer.from("data: \u2026\n\n"));

  const cases: readonly [string, string][] = [
    ["1", "id: 1\ndata: 1\n\ndata: 2\n\nid: 2\ndata:3\n\ndata:4\n\n"],
    ["2", "id: 1\ndata: 1\n\nid:\ndata:2\n\ndata:3\n\n"],
    ["3", "id: 1\ndata: 1\n\nid\ndata:2\n\ndata:3\n\n"],
    ["invalid", "id: 1\ndata: 1\n\ndata: 2\n\nid: 2\ndata:3\n\ndata:4\n\n"],
    ["4", "data: invalid_test\n\n"],
  ];
  for (const [type, expected] of cases) {
    const response = await resource(server, "/eventsource/resources/last-event-id2.py?type=" + type);
    assert.equal(response.body.toString(), expected, "ID variant " + type);
  }
});

suite("WPT status-error.py reproduces every status used by EventSource's error cases", async (t) => {
  const server = await serverFor(t);
  for (const status of [204, 205, 210, 299, 404, 410, 503]) {
    const response = await resource(server, "/eventsource/resources/status-error.py?status=" + status);
    assert.equal(response.status, status);
    assert.equal(response.statusText, "HAHAHAHA");
    assert.equal(response.headers["content-type"], "text/event-stream");
    assert.equal(response.body.toString(), status === 204 || status === 205 ? "" : "data: data\n\n");
  }
});

suite("WPT reconnect resources advance and clear their request cookies", async (t) => {
  const server = await serverFor(t);
  const first = await resource(server, "/eventsource/resources/status-reconnect.py?status=200&id=probe&ok_first");
  assert.equal(first.status, 200);
  assert.equal(first.statusText, "TEST");
  assert.equal(first.body.toString(), "retry: 2\ndata: ok\n\n");
  assert.ok(first.headers["set-cookie"]?.some((cookie) => cookie.startsWith("requestprobe=200;")));
  const second = await resource(server, "/eventsource/resources/status-reconnect.py?status=200&id=probe", {
    Cookie: "requestprobe=200",
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.toString(), "data: data\n\n");
  assert.ok(second.headers["set-cookie"]?.some((cookie) => cookie.includes("Max-Age=0")));

  const cases: readonly [string, number, string, string][] = [
    ["", 200, "OPEN", "retry: 2\ndata: opened\n\n"],
    ["recon_fail_probe=opened", 200, "RECONNECT", "data: reconnected\n\n"],
    ["recon_fail_probe=reconnected", 204, "NO CONTENT (CLOSE)", ""],
  ];
  for (const [cookie, status, statusText, body] of cases) {
    const response = await resource(server, "/eventsource/resources/reconnect-fail.py?id=probe", { Cookie: cookie });
    assert.equal(response.status, status);
    assert.equal(response.statusText, statusText);
    assert.equal(response.body.toString(), body);
    assert.ok(response.headers["set-cookie"]?.length === 1, "each transition writes its cookie");
  }
});

suite("WPT cors.py delegates message, reconnect, cache-control and redirect resources", async (t) => {
  const server = await serverFor(t);
  const headers = { Origin: server.httpOrigin, "Cache-Control": "no-cache" };
  for (const [run, expected] of [
    ["message", "data: data\n\n\n"],
    ["cache-control", "data: no-cache\n\n"],
    ["status-reconnect&status=200&id=cors-probe", "retry: 2\n"],
  ]) {
    const response = await resource(server, "/eventsource/resources/cors.py?run=" + run, headers);
    assert.equal(response.headers["access-control-allow-origin"], server.httpOrigin);
    assert.equal(response.headers["access-control-allow-credentials"], "true");
    assert.equal(response.body.toString(), expected);
  }
  const redirect = await resource(server,
    "/eventsource/resources/cors.py?run=redirect&status=307&location=/eventsource/resources/message.py",
    headers);
  assert.equal(redirect.status, 307);
  assert.equal(redirect.headers.location, "/eventsource/resources/message.py");
  assert.equal(redirect.headers["access-control-allow-origin"], server.httpOrigin);
  const override = await resource(server,
    "/eventsource/resources/cors.py?run=message&origin=https://example.test&credentials=false", headers);
  assert.equal(override.headers["access-control-allow-origin"], "https://example.test");
  assert.equal(override.headers["access-control-allow-credentials"], "false");
});

suite("WPT cors-cookie.py reports received cookies and can omit CORS credentials", async (t) => {
  const server = await serverFor(t);
  const first = await resource(server, "/eventsource/resources/cors-cookie.py?ident=probe", {
    Origin: server.httpOrigin,
  });
  assert.equal(first.body.toString(), "id: 1\nretry: 200\ndata: first NO_COOKIE\n\n");
  assert.ok(first.headers["set-cookie"]?.some((cookie) => cookie.startsWith("probe=COOKIE;")));
  const second = await resource(server, "/eventsource/resources/cors-cookie.py?ident=probe", {
    Origin: server.httpOrigin, "Last-Event-ID": "1", Cookie: "probe=COOKIE",
  });
  assert.equal(second.body.toString(), "id: 2\ndata: second COOKIE\n\n");
  assert.ok(second.headers["set-cookie"]?.some((cookie) => cookie.includes("2001")));
  const last = await resource(server, "/eventsource/resources/cors-cookie.py?ident=probe&origin=none&credentials=none", {
    Origin: server.httpOrigin, "Last-Event-ID": "2",
  });
  assert.equal(last.headers["content-type"], "stop");
  assert.equal(last.body.toString(), "data: 2NO_COOKIE\n\n");
  assert.equal(last.headers["access-control-allow-origin"], undefined);
  assert.equal(last.headers["access-control-allow-credentials"], undefined);
});

suite("the package EventSource class consumes the local WPT HTTP resource", async (t) => {
  const server = await serverFor(t);
  runtimeFor(t, server);
  const nativeClass: unknown = Object.getOwnPropertyDescriptor(globalThis, "EventSource")?.value;
  assert.notEqual(EventSource, nativeClass, "Node's EventSource must not be the implementation under test");
  const source = new EventSource("/eventsource/resources/message.py?message=data%3Apackage");
  t.after(() => source.close());
  assert.equal(source.constructor, EventSource);
  assert.ok(source instanceof EventTarget);
  const received = await messages(source, 1);
  const event = received[0];
  assert.ok(event instanceof MessageEvent);
  assert.equal(event.data, "package");
  assert.equal(event.origin, server.httpOrigin);
  assert.equal(event.target, source);
  assert.equal((event as { isTrusted?: unknown }).isTrusted, true);
  assert.equal(source.readyState, EventSource.CLOSED);
});

test("the package EventSource reconnects with cookies and stops on the resource's 204", { timeout: 120_000 }, async (t) => {
  const server = await serverFor(t);
  // Cookie state is opt-in for this server/mobile runtime. The resource selects
  // its next response from the cookie that the previous response set.
  const jar = new CookieJar({ urls: hostNodeURLs, wallTimeMilliseconds: Date.now });
  t.after(() => jar.close());
  runtimeFor(t, server, { cookies: new ServerCookiePolicy(jar) });
  const source = new EventSource("/eventsource/resources/reconnect-fail.py?id=package-probe");
  t.after(() => source.close());
  const done = Promise.withResolvers<void>();
  const log: string[] = [];
  let messageCount = 0;
  source.onopen = () => log.push("open");
  source.onmessage = (event) => {
    log.push("message:" + event.data);
    if (++messageCount > 2) {
      source.close();
      done.reject(new Error("The resource repeated a stage instead of reaching its 204 response"));
    }
  };
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) {
      log.push("closed");
      done.resolve();
    } else {
      log.push("retry");
    }
  };
  await done.promise;
  assert.deepEqual(log, ["open", "message:opened", "retry", "open", "message:reconnected", "retry", "closed"]);
  assert.equal(source.readyState, EventSource.CLOSED);
});

test("the package EventSource carries the UTF-8 Last-Event-ID through a redirect", { timeout: 120_000 }, async (t) => {
  const server = await serverFor(t);
  runtimeFor(t, server);
  const source = new EventSource("/common/redirect.py?location=/eventsource/resources/last-event-id.py");
  t.after(() => source.close());
  const done = Promise.withResolvers<MessageEvent<string>[]>();
  const received: MessageEvent<string>[] = [];
  source.onmessage = (event) => {
    received.push(event);
    if (received.length === 2) { source.close(); done.resolve(received); }
  };
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) done.reject(new Error("The redirect resource failed permanently"));
  };
  const result = await done.promise;
  assert.deepEqual(result.map((event) => event.data), ["hello", "\u2026"]);
  assert.deepEqual(result.map((event) => event.lastEventId), ["\u2026", "\u2026"]);
  assert.deepEqual(result.map((event) => event.origin), [server.httpOrigin, server.httpOrigin]);
});

suite("the package EventSource consumes WPT resources over verified TLS", async (t) => {
  const server = await serverFor(t);
  runtimeFor(t, server, { baseURL: server.httpsOrigin + "/", origin: server.httpsOrigin });
  const source = new EventSource("/eventsource/resources/message.py?message=data%3Asecure%E2%80%A6");
  t.after(() => source.close());
  const received = await messages(source, 1);
  assert.equal(received[0]?.data, "secure\u2026");
  assert.equal(received[0]?.origin, server.httpsOrigin);
});

suite("the package EventSource handles WPT's UTF-8 BOM split across response chunks", async (t) => {
  const server = await serverFor(t);
  runtimeFor(t, server);
  const source = new EventSource("/xhr/resources/content-in-chunks.py?type=text/event-stream" +
    "&chunk=ef&chunk=bbbf646174613a310a0a646174613a320a0a");
  t.after(() => source.close());
  const received = await messages(source, 2);
  assert.deepEqual(received.map((event) => event.data), ["1", "2"]);
});

suite("closing a package EventSource cancels the repeating message2 resource", async (t) => {
  const server = await serverFor(t);
  runtimeFor(t, server);
  const source = new EventSource("/eventsource/resources/message2.py");
  t.after(() => source.close());
  const received = await messages(source, 3);
  assert.deepEqual(received.map((event) => event.data), ["msg\nmsg", "", "end"]);
  assert.equal(source.readyState, EventSource.CLOSED);
  await server.close();
  assert.deepEqual(server.errors, [], "server shutdown settles the cancelled handler");
});

suite("WPT request header substitutions reach the package EventSource", async (t) => {
  const server = await serverFor(t);
  runtimeFor(t, server);
  for (const [path, expected] of [
    ["accept", "text/event-stream"], ["cache-control", "no-cache"],
  ]) {
    const source = new EventSource("/eventsource/resources/" + path + ".event_stream?pipe=sub");
    t.after(() => source.close());
    const received = await messages(source, 1);
    assert.equal(received[0]?.data, expected);
  }
});
