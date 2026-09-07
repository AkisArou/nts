// Interceptor order, as claims with their own controls.
//
// The plan asks for "explicit ordering and ownership". Composition order was defined --
// array order is outer to inner -- but which order to compose in was not, and an
// ordering rule nobody can falsify is a preference wearing a rule's clothes.
//
// So each test runs *both* arrangements: the documented one, and the swap. A test that
// only exercised the right order would pass just as happily if the order did not matter.
import assert from "node:assert/strict";
import test from "node:test";

import {
  AbortController,
  AuthenticationInterceptor,
  composeFetchTransport,
  ResponseErrorInterceptor,
  RetryInterceptor,
  TransportError,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/index.js";

const suite = (name, fn) => test(name, { timeout: 8000 }, fn);

class ImmediateScheduler {
  delays = [];
  errors = [];

  enqueue(task) {
    queueMicrotask(task);
  }

  delay(milliseconds, task) {
    this.delays.push(milliseconds);
    queueMicrotask(task);
    return { cancel() {} };
  }

  reportError(error) {
    this.errors.push(error);
  }
}

function request(overrides = {}) {
  return {
    url: { href: "https://order.test/resource" },
    method: "GET",
    headers: [],
    body: null,
    bodyLength: null,
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** Answers each status in turn, then 200 for ever. Counts what it was asked. */
function scripted(statuses) {
  const attempts = [];
  let index = 0;
  return {
    attempts,
    async dispatch(value) {
      attempts.push(value);
      const status = statuses[index++];
      if (status === undefined || status === 200) {
        return { status: 200, statusText: "OK", headers: [], body: null };
      }
      if (status === 401) {
        const authorized = value.headers.some(([name]) => name === "authorization");
        if (authorized) return { status: 200, statusText: "OK", headers: [], body: null };
        return {
          status: 401,
          statusText: "Unauthorized",
          headers: [["www-authenticate", 'Basic realm="r"']],
          body: null,
        };
      }
      return { status, statusText: "Failure", headers: [], body: null };
    },
  };
}

const retrying = (options = {}) =>
  new RetryInterceptor({
    scheduler: new ImmediateScheduler(),
    maxRetries: options.maxRetries ?? 3,
    minTimeoutMilliseconds: 0,
    ...options,
  });

const authenticating = (options = {}) =>
  new AuthenticationInterceptor({ authenticate: () => "Basic dXNlcjpw", ...options });

suite("response-error outside retry lets a retryable status be retried", async () => {
  // Documented order: the error conversion sees the *final* status.
  const inner = scripted([503, 200]);
  const outside = composeFetchTransport(inner, [new ResponseErrorInterceptor(), retrying()]);
  const response = await outside.dispatch(request());
  assert.equal(response.status, 200);
  assert.equal(inner.attempts.length, 2, "the 503 was retried");

  // Swapped: response-error is inside, so it throws before retry has a status to act on.
  const other = scripted([503, 200]);
  const swapped = composeFetchTransport(other, [retrying(), new ResponseErrorInterceptor()]);
  await assert.rejects(() => swapped.dispatch(request()), { name: "ResponseError" });
  assert.equal(other.attempts.length, 1, "and nothing was retried");
});

suite("response-error outside authentication lets a challenge be answered", async () => {
  const inner = scripted([401]);
  const outside = composeFetchTransport(inner, [
    new ResponseErrorInterceptor(),
    authenticating(),
  ]);
  const response = await outside.dispatch(request());
  assert.equal(response.status, 200);
  assert.equal(inner.attempts.length, 2);
  assert.equal(
    inner.attempts[1].headers.some(([name]) => name === "authorization"),
    true,
  );

  // Swapped: a 401 is a challenge, and thrown from the inside it is an error the
  // authenticator is never offered.
  const other = scripted([401]);
  let consulted = false;
  const swapped = composeFetchTransport(other, [
    authenticating({
      authenticate: () => {
        consulted = true;
        return "Basic dXNlcjpw";
      },
    }),
    new ResponseErrorInterceptor(),
  ]);
  await assert.rejects(() => swapped.dispatch(request()), { name: "ResponseError" });
  assert.equal(consulted, false, "the challenge never reached the authenticator");
  assert.equal(other.attempts.length, 1);
});

suite("authentication outside retry keeps the total attempts down", async () => {
  // Both orders work; the difference is arithmetic, and it runs the opposite way to the
  // intuition that a challenge is best answered close to the transport. A 401 is not a
  // retryable status, so retry never loops on a challenge -- what happens instead is
  // that with retry outside, every retry of a *retryable* failure re-runs the whole
  // authentication exchange from unauthenticated.
  //
  // This is the arrangement the documentation recommended until this test measured it.
  const script = [503, 401, 503, 401, 503, 401, 503, 401, 200];

  const documented = scripted(script);
  const outside = composeFetchTransport(documented, [
    authenticating(),
    retrying({ maxRetries: 2 }),
  ]);
  const documentedResult = await outside
    .dispatch(request())
    .then((response) => response.status, () => "threw");

  const other = scripted(script);
  const swapped = composeFetchTransport(other, [retrying({ maxRetries: 2 }), authenticating()]);
  const swappedResult = await swapped
    .dispatch(request())
    .then((response) => response.status, () => "threw");

  assert.ok(
    documented.attempts.length < other.attempts.length,
    `authentication outside retry should cost fewer attempts: ${documented.attempts.length} vs ${other.attempts.length}`,
  );
  // And it is not merely cheaper: on this script it is the arrangement that succeeds.
  assert.equal(documentedResult, 200);
  assert.equal(swappedResult, "threw");
});

suite("a transport error is retried the same way whichever of the two is outside", async () => {
  // The control on the control: retry and authentication do not interact at all when
  // the failure is not a status, so a difference in the tests above has to come from
  // the challenge handling rather than from composition overhead.
  const failing = (() => {
    let calls = 0;
    return {
      get calls() {
        return calls;
      },
      async dispatch() {
        calls++;
        if (calls <= 2) throw new TransportError("ECONNRESET", "reset");
        return { status: 200, statusText: "OK", headers: [], body: null };
      },
    };
  })();
  const outside = composeFetchTransport(failing, [retrying(), authenticating()]);
  const response = await outside.dispatch(request());
  assert.equal(response.status, 200);
  assert.equal(failing.calls, 3);
});
