// Original controls for the HTTP resource translations, not WPT case counts.
// Canonical Fetch is exercised only after its prerequisite source stack lands.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import test from "node:test";
import type { TestContext } from "node:test";
import { startWptServer } from "./wpt/server/server.ts";
import type { WptServer } from "./wpt/server/server.ts";

interface Result {
  readonly status: number;
  readonly statusText: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

interface RequestOptions {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: Buffer;
  readonly chunks?: readonly Buffer[];
  readonly secure?: boolean;
  readonly index?: number;
}

async function serverFor(t: TestContext): Promise<WptServer> {
  const server = await startWptServer();
  t.after(async () => {
    await server.close();
    assert.deepEqual(server.errors, [], "HTTP resources must not fail silently");
  });
  return server;
}

function request(server: WptServer, path: string, options: RequestOptions = {}): Promise<Result> {
  return new Promise((resolve, reject) => {
    const secure = options.secure ?? false;
    const port = (secure ? server.ports.https : server.ports.http)[options.index ?? 0];
    const req = (secure ? httpsRequest : httpRequest)({
      hostname: "127.0.0.1", port, path, method: options.method ?? "GET",
      ca: server.ca, servername: "web-platform.test", agent: false,
      headers: { Host: `web-platform.test:${port}`, ...options.headers },
    }, (response) => {
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
    req.once("error", reject);
    for (const chunk of options.chunks ?? []) req.write(chunk);
    req.end(options.body);
  });
}

const resource = "/fetch/api/resources/";

test("finite network Fetch WPT resources", async (t) => {
  await t.test("static JSON resources preserve file bytes and use application/json", async (t) => {
    const server = await serverFor(t);
    const expected = await readFile(new URL("./wpt/server/upstream-manifest.json", import.meta.url));
    const response = await request(server, "/server/upstream-manifest.json");
    assert.equal(response.status, 200);
    assert.equal(response.headers["content-type"], "application/json");
    assert.deepEqual(response.body, expected);
  });

  await t.test("echo-content returns every uploaded byte and original request metadata on HTTP and HTTPS", async (t) => {
    const server = await serverFor(t);
    const body = Buffer.from([0, 255, 195, 40, 13, 10, 128]);
    for (const secure of [false, true]) {
      for (const index of [0, 1]) {
        const response = await request(server, resource + "echo-content.py", {
          secure, index, method: "POST", body,
          headers: { "Content-Type": "application/octet-stream", "Content-Length": String(body.length) },
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers["content-type"], "text/plain");
        assert.equal(response.headers["x-request-method"], "POST");
        assert.equal(response.headers["x-request-content-length"], String(body.length));
        assert.equal(response.headers["x-request-content-type"], "application/octet-stream");
        assert.deepEqual(response.body, body);
      }
    }
    const absent = await request(server, resource + "echo-content.py");
    assert.equal(absent.headers["x-request-content-length"], "NO");
    assert.equal(absent.headers["x-request-content-type"], "NO");
    assert.equal(absent.body.length, 0);
  });

  await t.test("echo-content waits for the complete chunked upload without inventing a content length", async (t) => {
    const server = await serverFor(t);
    const chunks = [Buffer.from([0, 255]), Buffer.from("middle"), Buffer.from([128])];
    const response = await request(server, resource + "echo-content.py", { method: "PUT", chunks });
    assert.deepEqual(response.body, Buffer.concat(chunks));
    assert.equal(response.headers["x-request-method"], "PUT");
    assert.equal(response.headers["x-request-content-length"], "NO");
  });

  await t.test("method echoes body headers and distinguishes omitted from present fields", async (t) => {
    const server = await serverFor(t);
    const response = await request(server, resource + "method.py?cors", {
      method: "POST", body: Buffer.from("body"),
      headers: {
        "Content-Encoding": "Identity", "Content-Language": "en-US",
        "Content-Location": "here", "Content-Type": "text/plain", "Content-Length": "4",
      },
    });
    assert.equal(response.body.toString(), "body");
    assert.equal(response.headers["x-request-method"], "POST");
    assert.equal(response.headers["x-request-content-length"], "4");
    assert.equal(response.headers["x-request-content-type"], "text/plain");
    assert.equal(response.headers["x-request-content-encoding"], "Identity");
    assert.equal(response.headers["x-request-content-language"], "en-US");
    assert.equal(response.headers["x-request-content-location"], "here");
    assert.equal(response.headers["access-control-allow-methods"], "GET, POST, PUT, FOO");
    const absent = await request(server, resource + "method.py");
    for (const name of ["content-encoding", "content-language", "content-location", "content-length", "content-type"]) {
      assert.equal(absent.headers["x-request-" + name], "NO", name);
    }
    assert.equal(absent.headers["access-control-allow-origin"], undefined);
  });

  await t.test("status preserves status text, content type and percent-decoded bytes", async (t) => {
    const server = await serverFor(t);
    const response = await request(server, resource + "status.py?code=418&text=still+here&type=application%2Ftest&content=%00%ff%80%2B+end", { method: "POST" });
    assert.equal(response.status, 418);
    assert.equal(response.statusText, "still here");
    assert.equal(response.headers["content-type"], "application/test");
    assert.equal(response.headers["x-request-method"], "POST");
    assert.deepEqual(response.body, Buffer.from([0, 255, 128, 43, 32, 101, 110, 100]));
    const defaults = await request(server, resource + "status.py");
    assert.equal(defaults.status, 200);
    assert.equal(defaults.statusText, "OMG");
    assert.equal(defaults.headers["content-type"], "");
    assert.equal(defaults.body.length, 0);
    const emptyPhrase = await request(server, resource + "status.py?text=");
    assert.equal(emptyPhrase.status, 200);
    assert.equal(emptyPhrase.statusText, "", "an explicitly empty status phrase is preserved");
    for (const code of [204, 304]) {
      const noBody = await request(server, resource + `status.py?code=${code}&content=discarded`);
      assert.equal(noBody.status, code);
      assert.equal(noBody.body.length, 0);
    }
    const head = await request(server, resource + "status.py?content=discarded", { method: "HEAD" });
    assert.equal(head.headers["x-request-method"], "HEAD");
    assert.equal(head.body.length, 0);
  });

  await t.test("header inspection and hexadecimal echo preserve non-ASCII octets and missing headers", async (t) => {
    const server = await serverFor(t);
    const headers = { "X-Byte": "before-\u00ff\u0080-after", Origin: server.httpOrigin };
    const response = await request(server, resource + "inspect-headers.py?headers=X-Byte%7Cmissing&cors&allow_headers=x-byte", { headers });
    assert.equal(response.headers["x-request-x-byte"], headers["X-Byte"]);
    assert.equal(response.headers["x-request-missing"], undefined);
    assert.equal(response.headers["access-control-allow-origin"], server.httpOrigin);
    assert.equal(response.headers["access-control-allow-credentials"], "true");
    assert.equal(response.headers["access-control-allow-headers"], "x-byte");
    assert.equal(response.headers["access-control-expose-headers"], "x-request-X-Byte, x-request-missing");
    const bytes = await request(server, resource + "echo-header-bytes.py?headers=X-Byte%7Cmissing", { headers });
    assert.equal(bytes.body.toString(), "X-Byte: 6265666f72652dff802d6166746572\nmissing: ");
    const wildcard = await request(server, resource + "inspect-headers.py?headers=host&cors");
    assert.equal(wildcard.headers["access-control-allow-origin"], "*");
    assert.ok(String(wildcard.headers["access-control-allow-headers"]).includes("host"));
  });

  await t.test("redirect preserves simple Location bytes, status, policy and CORS metadata", async (t) => {
    const server = await serverFor(t);
    const location = "/where?a=%2B#fragment";
    const response = await request(server, resource + "redirect.py?simple&redirect_status=307&location=" + encodeURIComponent(location)
      + "&redirect_referrerpolicy=no-referrer", { headers: { Origin: server.httpOrigin } });
    assert.equal(response.status, 307);
    assert.equal(response.headers.location, location);
    assert.equal(response.headers["referrer-policy"], "no-referrer");
    assert.equal(response.headers["cache-control"], "no-cache");
    assert.equal(response.headers.pragma, "no-cache");
    assert.equal(response.headers["access-control-allow-origin"], server.httpOrigin);
    assert.equal(response.headers["access-control-allow-credentials"], "true");
    const missing = await request(server, resource + "redirect.py");
    assert.equal(missing.status, 302);
    assert.equal(missing.headers.location, undefined);
    const empty = await request(server, resource + "redirect-empty-location.py");
    assert.equal(empty.status, 302);
    assert.equal(empty.headers.location, "");
  });

  await t.test("redirect query propagation uses Python form quoting, first duplicate values and scheme rules", async (t) => {
    const server = await serverFor(t);
    const response = await request(server, resource + "redirect.py?location=%2Fnext&word=a+b&word=ignored&odd=%21%7E%2A&byte=%ff");
    assert.equal(response.headers.location, "/next?location=%2Fnext&word=a+b&odd=%21~%2A&byte=%C3%BF&count=1");
    const query = await request(server, resource + "redirect.py?location=%2Fnext%3Fexisting%3D1&n=2");
    assert.equal(query.headers.location, "/next?existing=1&location=%2Fnext%3Fexisting%3D1&n=2&count=1");
    for (const target of ["data:text/plain,hello", "about:blank", "mailto:example@example.test"]) {
      const other = await request(server, resource + "redirect.py?location=" + encodeURIComponent(target));
      assert.equal(other.headers.location, target);
    }
  });

  await t.test("redirect counts are instance-local and terminate exactly after max_count", async (t) => {
    const first = await serverFor(t);
    const second = await serverFor(t);
    const path = resource + "redirect.py?token=loop&max_count=2&redirect_status=308&location=redirect.py";
    let next = path;
    for (let count = 1; count <= 2; count++) {
      const response = await request(first, next);
      assert.equal(response.status, 308);
      assert.ok(response.headers.location?.endsWith("&count=" + count));
      next = new URL(String(response.headers.location), first.httpOrigin + next).pathname
        + new URL(String(response.headers.location), first.httpOrigin + next).search;
    }
    const terminal = await request(first, next);
    assert.equal(terminal.status, 200);
    assert.equal(terminal.body.toString(), "2");
    assert.equal(terminal.headers.location, undefined);
    const independent = await request(second, path);
    assert.equal(independent.status, 308);
    assert.ok(independent.headers.location?.endsWith("&count=1"));
    assert.equal((await request(first, resource + "clean-stash.py?token=loop")).body.toString(), "1");
    assert.equal((await request(first, resource + "clean-stash.py?token=loop")).body.toString(), "0");
    assert.equal((await request(second, resource + "clean-stash.py?token=loop")).body.toString(), "1");
  });

  await t.test("redirect preflight bookkeeping does not consume a redirect count unless requested", async (t) => {
    const server = await serverFor(t);
    const base = resource + "redirect.py?token=options&location=method.py&allow_headers=x-test";
    const options = await request(server, base, { method: "OPTIONS" });
    assert.equal(options.status, 200);
    assert.equal(options.headers.location, undefined);
    assert.equal(options.headers["access-control-allow-headers"], "x-test");
    const stash = server.state.take(resource, "options");
    assert.deepEqual(stash, { count: 0, preflight: "1" });
    server.state.put(resource, "options", stash);
    const actual = await request(server, base);
    assert.ok(actual.headers.location?.endsWith("&count=1"));
    const redirectOptions = await request(server, base + "&redirect_preflight", { method: "OPTIONS" });
    assert.equal(redirectOptions.status, 302);
    assert.ok(redirectOptions.headers.location?.endsWith("&count=2"));
  });

  await t.test("redirect status may come from a URL-encoded upload and query status takes priority", async (t) => {
    const server = await serverFor(t);
    const options = {
      method: "POST", body: Buffer.from("redirect_status=303"),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    };
    assert.equal((await request(server, resource + "redirect.py?simple&location=%2F", options)).status, 303);
    assert.equal((await request(server, resource + "redirect.py?simple&location=%2F&redirect_status=307", options)).status, 307);
  });

  await t.test("redirect form parsing retains raw hash bytes and decodes field names without URL parsing", async (t) => {
    const server = await serverFor(t);
    const response = await request(server, resource + "redirect.py?simple&location=%2F", {
      method: "POST", body: Buffer.from("unused=#&redirect%5fstatus=%33%30%37&redirect_status=303"),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    assert.equal(response.status, 307);
    assert.equal(response.headers.location, "/");
  });

  await t.test("multipart redirect status is explicitly unsupported unless query status already supplies it", async () => {
    const server = await startWptServer();
    try {
      const options = {
        method: "POST",
        body: Buffer.from('--boundary\r\nContent-Disposition: form-data; name="redirect_status"\r\n\r\n307\r\n--boundary--\r\n'),
        headers: { "Content-Type": "multipart/form-data; boundary=boundary" },
      };
      const unsupported = await request(server, resource + "redirect.py?simple&location=%2F", options);
      assert.equal(unsupported.status, 500);
      assert.equal(server.errors.length, 1);
      assert.match(String(server.errors[0]), /requires multipart form parsing/);
      const query = await request(server, resource + "redirect.py?simple&location=%2F&redirect_status=308", options);
      assert.equal(query.status, 308);
      assert.equal(server.errors.length, 1, "query precedence does not require multipart parsing");
    } finally { await server.close(); }
  });

  await t.test("numeric resource parameters reject high-bit bytes and Unicode whitespace instead of clearing or trimming them", async () => {
    const server = await startWptServer();
    try {
      for (const value of ["%B2%30%30", "%A0200"]) {
        const response = await request(server, resource + "status.py?code=" + value);
        assert.equal(response.status, 500, value);
      }
      assert.match(String(server.errors[0]), /Invalid WPT Fetch integer/);
      assert.match(String(server.errors[1]), /Invalid WPT Fetch integer/);
      const ascii = await request(server, resource + "status.py?code=%09%2B2_00%20");
      assert.equal(ascii.status, 200, "Python's ASCII whitespace and digit separators remain valid");
      for (const value of ["%B0", "0x0", "%A00"]) {
        const response = await request(server, resource + "redirect.py?delay=" + value);
        assert.equal(response.status, 500, value);
      }
      assert.equal(server.errors.length, 5);
      for (const error of server.errors.slice(2)) assert.match(String(error), /requires an injected clock/);
      const zero = await request(server, resource + "redirect.py?delay=%20-0.0e%2B1%09");
      assert.equal(zero.status, 302);
      assert.equal(server.errors.length, 5);
    } finally { await server.close(); }
  });

  await t.test("unprepared pipe modifiers fail on each new route without intercepting routes it does not own", async () => {
    const server = await startWptServer();
    try {
      const paths = ["echo-content.py", "method.py", "status.py", "inspect-headers.py", "echo-header-bytes.py",
        "redirect.py", "redirect-empty-location.py", "clean-stash.py", "authentication.py", "dump-authorization-header.py"];
      for (const path of paths) {
        const response = await request(server, resource + path + "?pipe=status(404)");
        assert.equal(response.status, 500, path);
      }
      assert.equal(server.errors.length, paths.length);
      for (const error of server.errors) assert.match(String(error), /Unsupported WPT Fetch pipe modifier/);
      const unknown = await request(server, resource + "not-prepared.py?pipe=status(404)");
      assert.equal(unknown.status, 404);
      assert.equal(server.errors.length, paths.length);
    } finally { await server.close(); }
  });

  await t.test("authentication and authorization dump preserve the upstream challenge and preflight distinctions", async (t) => {
    const server = await serverFor(t);
    const challenge = await request(server, resource + "authentication.py?realm=testing");
    assert.equal(challenge.status, 401);
    assert.equal(challenge.headers["www-authenticate"], 'Basic realm="testing"');
    const authorization = "Basic " + Buffer.from("user:password").toString("base64");
    const accepted = await request(server, resource + "authentication.py", { headers: { Authorization: authorization } });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.toString(), "Authentication done");
    const dumped = await request(server, resource + "dump-authorization-header.py", { headers: { Authorization: authorization, Origin: server.httpOrigin } });
    assert.equal(dumped.body.toString(), authorization);
    assert.equal(dumped.headers["access-control-allow-origin"], server.httpOrigin);
    const absent = await request(server, resource + "dump-authorization-header.py");
    assert.equal(absent.body.toString(), "none");
    const failed = await request(server, resource + "dump-authorization-header.py?strip_auth_header=1", {
      method: "OPTIONS", headers: { "Access-Control-Request-Headers": "X-Test, Authorization" },
    });
    assert.equal(failed.status, 500);
    assert.equal(failed.body.toString(), "fail");
    assert.equal(failed.headers["access-control-allow-origin"], undefined);
  });

  await t.test("malformed parameters and delayed modes remain explicit server errors", async () => {
    const server = await startWptServer();
    try {
      for (const path of ["echo-header-bytes.py", "status.py?code=two", "redirect.py?delay=1", "clean-stash.py"]) {
        const response = await request(server, resource + path);
        assert.equal(response.status, 500, path);
        assert.equal(response.body.toString(), "WPT resource failed", path);
      }
      assert.equal(server.errors.length, 4);
      assert.match(String(server.errors[0]), /Missing WPT Fetch resource parameter: headers/);
      assert.match(String(server.errors[1]), /Invalid WPT Fetch integer: two/);
      assert.match(String(server.errors[2]), /requires an injected clock/);
      assert.match(String(server.errors[3]), /Missing WPT Fetch resource parameter: token/);
    } finally { await server.close(); }
  });
});
