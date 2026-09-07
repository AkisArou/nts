// Origin authentication: parsing challenges, and answering them exactly once.
//
// The plan asks for "authentication hooks with explicit ordering and ownership" and
// this lane had proxy authentication only. Proxy credentials are not origin credentials
// and the two must not be answered by the same thing: a hop that challenges is not
// necessarily the hop the caller has an account with.
//
// The parser is where the difficulty is. A comma separates both challenges and
// auth-params, so the same character means two things and only lookahead tells them
// apart.
import assert from "node:assert/strict";
import test from "node:test";

import {
  AbortController,
  AuthenticationInterceptor,
  parseChallenges,
  ReadableStream,
  TextEncoder,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/index.js";

const suite = (name, fn) => test(name, { timeout: 8000 }, fn);
const encoder = new TextEncoder();

const schemes = (value) => parseChallenges(value).map((challenge) => challenge.scheme);
const paramsOf = (value, index = 0) => parseChallenges(value)[index]?.parameters;

suite("a single challenge with one parameter", () => {
  const [challenge] = parseChallenges('Basic realm="simple"');
  assert.equal(challenge.scheme, "basic");
  assert.equal(challenge.token68, null);
  assert.deepEqual(challenge.parameters, [["realm", "simple"]]);
});

suite("a comma separates challenges and parameters, and lookahead tells them apart", () => {
  // One challenge: every comma is followed by `token=`.
  assert.deepEqual(schemes('Digest realm="a", qop="auth", nonce="x"'), ["digest"]);
  assert.deepEqual(paramsOf('Digest realm="a", qop="auth", nonce="x"'), [
    ["realm", "a"],
    ["qop", "auth"],
    ["nonce", "x"],
  ]);

  // Two challenges: the comma is followed by a bare token.
  assert.deepEqual(schemes('Basic realm="a", Bearer'), ["basic", "bearer"]);
  assert.deepEqual(schemes("Negotiate, Basic"), ["negotiate", "basic"]);
});

suite("RFC 7235's own ambiguous example parses as the RFC says", () => {
  // The example the specification uses to explain why this is hard, including an
  // escaped quote inside a parameter value.
  const value =
    'Newauth realm="apps", type=1, title="Login to \\"apps\\"", Basic realm="simple"';
  const parsed = parseChallenges(value);
  assert.deepEqual(
    parsed.map((challenge) => challenge.scheme),
    ["newauth", "basic"],
  );
  assert.deepEqual(parsed[0].parameters, [
    ["realm", "apps"],
    ["type", "1"],
    ["title", 'Login to "apps"'],
  ]);
  assert.deepEqual(parsed[1].parameters, [["realm", "simple"]]);
});

suite("a scheme with nothing after it is still a challenge", () => {
  assert.deepEqual(schemes("Negotiate"), ["negotiate"]);
  const [challenge] = parseChallenges("Negotiate");
  assert.equal(challenge.token68, null);
  assert.deepEqual(challenge.parameters, []);
});

suite("token68 is kept apart from parameters", () => {
  // `Negotiate abc==` is an opaque credential, not a nameless parameter, and an
  // authenticator has to be able to tell the difference.
  const [challenge] = parseChallenges("Negotiate a87421bK3bkfhk==");
  assert.equal(challenge.scheme, "negotiate");
  assert.equal(challenge.token68, "a87421bK3bkfhk==");
  assert.deepEqual(challenge.parameters, []);
});

suite("schemes and parameter names are matched case-insensitively", () => {
  const [challenge] = parseChallenges('BASIC REALM="Kept As Sent"');
  assert.equal(challenge.scheme, "basic");
  // The name is folded because callers compare it; the value is not, because it is data.
  assert.deepEqual(challenge.parameters, [["realm", "Kept As Sent"]]);
});

suite("a bare token parameter value is read", () => {
  assert.deepEqual(paramsOf("Bearer error=invalid_token"), [["error", "invalid_token"]]);
});

suite("surrounding and repeated commas are tolerated", () => {
  assert.deepEqual(schemes(",, Basic ,, Bearer ,,"), ["basic", "bearer"]);
  assert.deepEqual(schemes(""), []);
  assert.deepEqual(schemes("   "), []);
  assert.deepEqual(schemes(","), []);
});

suite("a malformed tail keeps what was already understood", () => {
  // A field that cannot be fully parsed is not a reason to discard a challenge the
  // server did send -- refusing the lot would turn a server's sloppiness into a client
  // that cannot authenticate at all.
  assert.deepEqual(schemes('Basic realm="unterminated'), ["basic"]);
  assert.deepEqual(schemes('Basic realm="a", Bearer realm='), ["basic", "bearer"]);
  assert.deepEqual(paramsOf('Basic realm="a", Bearer realm=', 0), [["realm", "a"]]);
});

function request(overrides = {}) {
  return {
    url: { href: "https://auth.test/resource" },
    method: "GET",
    headers: [["accept", "*/*"]],
    body: null,
    bodyLength: null,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function bodyOf(text) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

/** Answers `401` until an `Authorization` header arrives, recording every attempt. */
function challengingTransport(options = {}) {
  const seen = [];
  let cancelled = 0;
  let drained = 0;
  return {
    seen,
    get cancelled() {
      return cancelled;
    },
    /** Challenge bodies read all the way to their close. */
    get drained() {
      return drained;
    },
    async dispatch(value) {
      seen.push(value);
      const authorization = value.headers.find(([name]) => name === "authorization");
      if (authorization !== undefined && options.acceptCredential !== false) {
        return { status: 200, statusText: "OK", headers: [], body: null };
      }
      return {
        status: options.status ?? 401,
        statusText: "Unauthorized",
        headers: options.headers ?? [["www-authenticate", 'Basic realm="test"']],
        // A zero high-water mark, so `pull` fires only when something actually reads.
        // With the default of one, the stream prefetches on construction and `drained`
        // would count that rather than the interceptor -- which is how this assertion
        // was wrong the first time it was written.
        body: new ReadableStream(
          {
            pull(controller) {
              drained++;
              controller.enqueue(encoder.encode("please authenticate"));
              controller.close();
            },
            cancel() {
              cancelled++;
            },
          },
          { highWaterMark: 0 },
        ),
      };
    },
  };
}

suite("a challenge is answered once and the retry carries the credential", async () => {
  const transport = challengingTransport();
  const contexts = [];
  const interceptor = new AuthenticationInterceptor({
    authenticate: (context) => {
      contexts.push(context);
      return "Basic dXNlcjpwYXNz";
    },
  });

  const response = await interceptor.dispatch(request(), transport);
  assert.equal(response.status, 200);
  assert.equal(transport.seen.length, 2);

  // Never preemptive: the first request goes out as the caller wrote it.
  assert.equal(
    transport.seen[0].headers.some(([name]) => name === "authorization"),
    false,
    "credentials must not be sent before they are asked for",
  );
  assert.deepEqual(
    transport.seen[1].headers.find(([name]) => name === "authorization"),
    ["authorization", "Basic dXNlcjpwYXNz"],
  );
  // And the rest of the request survives the rewrite.
  assert.deepEqual(transport.seen[1].headers.find(([name]) => name === "accept"), [
    "accept",
    "*/*",
  ]);

  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].attempt, 1);
  assert.equal(contexts[0].status, 401);
  assert.deepEqual(
    contexts[0].challenges.map((challenge) => challenge.scheme),
    ["basic"],
  );
});

suite("an authenticator that declines returns the challenge untouched", async () => {
  const transport = challengingTransport();
  const interceptor = new AuthenticationInterceptor({ authenticate: () => null });

  const response = await interceptor.dispatch(request(), transport);
  assert.equal(response.status, 401);
  assert.equal(transport.seen.length, 1);
  // The body is left for the caller to read: declining is not consuming.
  assert.notEqual(response.body, null);
  assert.equal(transport.cancelled, 0);
  assert.equal(transport.drained, 0, "declining is not consuming");
});

suite("attempts are bounded, and the last challenge is what the caller gets", async () => {
  const transport = challengingTransport({ acceptCredential: false });
  let calls = 0;
  const interceptor = new AuthenticationInterceptor({
    authenticate: () => {
      calls++;
      return "Basic wrong";
    },
    maximumAttempts: 2,
  });

  const response = await interceptor.dispatch(request(), transport);
  assert.equal(response.status, 401);
  assert.equal(calls, 2, "two attempts, not an unbounded retry");
  assert.equal(transport.seen.length, 3, "the original and two answers");
});

suite("a status that is not a challenge never reaches the authenticator", async () => {
  const transport = challengingTransport({ status: 403 });
  let called = false;
  const interceptor = new AuthenticationInterceptor({
    authenticate: () => {
      called = true;
      return "Basic x";
    },
  });

  const response = await interceptor.dispatch(request(), transport);
  assert.equal(response.status, 403);
  assert.equal(called, false);
});

suite("challenges from several fields are collected in order", async () => {
  const transport = challengingTransport({
    headers: [
      ["www-authenticate", 'Basic realm="one"'],
      ["x-other", "ignored"],
      ["www-authenticate", "Negotiate"],
    ],
  });
  let seen;
  const interceptor = new AuthenticationInterceptor({
    authenticate: (context) => {
      seen = context.challenges;
      return null;
    },
  });

  await interceptor.dispatch(request(), transport);
  assert.deepEqual(
    seen.map((challenge) => challenge.scheme),
    ["basic", "negotiate"],
  );
});

suite("proxy authentication cannot be configured here", () => {
  // 407 is the proxy's, and the proxy layer knows which hop challenged. Answering it
  // here would send origin credentials to a proxy.
  assert.throws(
    () => new AuthenticationInterceptor({ authenticate: () => null, statuses: [401, 407] }),
    RangeError,
  );
  assert.throws(
    () => new AuthenticationInterceptor({ authenticate: () => null, maximumAttempts: 0 }),
    RangeError,
  );
});

suite("a one-shot body is refused rather than answered with an empty one", async () => {
  const transport = challengingTransport();
  const interceptor = new AuthenticationInterceptor({ authenticate: () => "Basic x" });

  // Answering with an empty body would show the server an authenticated request that
  // is not the one the caller made, which is worse than not answering.
  await assert.rejects(
    () =>
      interceptor.dispatch(
        request({ body: bodyOf("payload"), bodyLength: 7 }),
        transport,
      ),
    TypeError,
  );
});

suite("a replayable body is sent again with the credential", async () => {
  const transport = challengingTransport();
  const interceptor = new AuthenticationInterceptor({ authenticate: () => "Basic x" });
  const source = { length: 7, open: () => bodyOf("payload") };

  const response = await interceptor.dispatch(
    request({ body: source.open(), bodyLength: 7, replayBody: source }),
    transport,
  );
  assert.equal(response.status, 200);
  assert.notEqual(transport.seen[1].body, null);
  assert.equal(transport.seen[1].bodyLength, 7);
});

suite("the challenge body is consumed before the connection carries the answer", async () => {
  const transport = challengingTransport();
  const interceptor = new AuthenticationInterceptor({ authenticate: () => "Basic x" });

  await interceptor.dispatch(request(), transport);
  // Read to the end rather than cancelled, which is what leaves an HTTP/1 connection
  // reusable. Asserting only "not cancelled" would hold equally if nothing read it.
  assert.equal(transport.drained, 1, "the challenge body was read to its close");
  assert.equal(transport.cancelled, 0);
});
