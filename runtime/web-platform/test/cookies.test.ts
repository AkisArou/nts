import test from "node:test";
import assert from "node:assert/strict";
import {
  CookieJar,
  Headers,
  MemoryCookieJarStore,
  ServerCookiePolicy,
  deleteCookie,
  getCookiePairs,
  getSetCookies,
  parseCookie,
  parseCookieDate,
  serializeCookie,
  setCookie,
} from "../src/index.ts";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import type { CookieJarStore, StoredCookie } from "../src/cookies/jar.ts";
import type { FetchTransport } from "../src/fetch/transport.ts";

createHostNodeWebPlatform();

test("cookie-date parsing follows RFC6265bis rather than host Date.parse", () => {
  assert.equal(
    parseCookieDate("Wed, 09 Jun 2021 10:18:14 GMT")?.toISOString(),
    "2021-06-09T10:18:14.000Z",
  );
  assert.equal(parseCookieDate("09-Jun-69 10:18:14")?.toISOString(), "2069-06-09T10:18:14.000Z");
  assert.equal(parseCookieDate("09-Jun-70 10:18:14")?.toISOString(), "1970-06-09T10:18:14.000Z");
  assert.equal(parseCookieDate("Thu, 31 Feb 2021 10:18:14 GMT"), null);
  assert.equal(parseCookieDate("Thu, 01 Jan 1600 00:00:00 GMT"), null);
  assert.equal(parseCookieDate("Thu, 01 Jan 2021 24:00:00 GMT"), null);
});

test("standalone cookie helpers parse, serialize and preserve Set-Cookie fields", () => {
  const parsed = parseCookie(
    "SID=31d4d96e407aad42; Path=/; Secure; HttpOnly; SameSite=Lax; Foo=bar=baz",
  );
  assert.deepEqual(
    {
      ...parsed,
      expires: parsed?.expires instanceof Date ? parsed.expires.toISOString() : parsed?.expires,
    },
    {
      name: "SID",
      value: "31d4d96e407aad42",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
      unparsed: ["Foo=bar=baz"],
      expires: undefined,
    },
  );
  assert.equal(parseCookie("a=b\u0000c"), null);
  assert.equal(parseCookie("x".repeat(4097) + "=v"), null);

  assert.equal(
    serializeCookie({
      name: "session",
      value: "abc",
      expires: 0,
      maxAge: 30,
      domain: "example.test",
      path: "/account",
      secure: true,
      httpOnly: true,
      sameSite: "Strict",
    }),
    "session=abc; Secure; HttpOnly; Max-Age=30; Domain=example.test; Path=/account; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict",
  );
  assert.equal(
    serializeCookie({ name: "__hOsT-token", value: "v", domain: "evil.test", path: "/x" }),
    "__hOsT-token=v; Secure; Path=/",
  );
  assert.equal(serializeCookie({ name: "a", value: "b", expires: -1 }), "a=b");

  const headers = new Headers({ cookie: "a=1; token=a=b; bare" });
  assert.deepEqual(getCookiePairs(headers), [
    ["a", "1"],
    ["token", "a=b"],
    ["bare", ""],
  ]);
  setCookie(headers, { name: "a", value: "1", sameSite: "None", secure: true });
  deleteCookie(headers, "gone", { path: "/" });
  assert.deepEqual(
    getSetCookies(headers).map((cookie) =>
      cookie.expires === undefined
        ? cookie
        : {
            ...cookie,
            expires: cookie.expires instanceof Date ? cookie.expires.getTime() : cookie.expires,
          },
    ),
    [
      { name: "a", value: "1", secure: true, sameSite: "None" },
      { name: "gone", value: "", expires: 0, path: "/" },
    ],
  );
});

test("cookie serialization rejects attribute injection and invalid wire grammar", () => {
  assert.throws(
    () => serializeCookie({ name: "a", value: "b", domain: "example.test; Secure" }),
    /Invalid cookie domain/,
  );
  assert.throws(
    () => serializeCookie({ name: "a", value: "b", unparsed: ["Path=/; Secure"] }),
    /Invalid cookie value/,
  );
  assert.throws(() => serializeCookie({ name: "a", value: "b", maxAge: -1 }), /max-age/);
  assert.throws(() => serializeCookie({ name: "a;b", value: "c" }), /name/);
  assert.throws(() => serializeCookie({ name: "a", value: "b,c" }), /value/);
});

test("CookieJar applies domain, path, secure, HttpOnly and SameSite policy", async () => {
  let now = Date.UTC(2026, 0, 1);
  const jar = new CookieJar({ wallTimeMilliseconds: () => now });
  const source = "https://sub.example.test/app/page";

  assert.equal(await jar.setCookie("host=1; Path=/app", source), true);
  assert.equal(await jar.setCookie("domain=2; Domain=example.test; Path=/", source), true);
  assert.equal(await jar.setCookie("secure=3; Secure; Path=/", source), true);
  assert.equal(await jar.setCookie("hidden=4; HttpOnly; Path=/", source), true);
  assert.equal(await jar.setCookie("strict=5; SameSite=Strict; Path=/", source), true);
  assert.equal(await jar.setCookie("lax=6; SameSite=Lax; Path=/", source), true);
  assert.equal(await jar.setCookie("none=7; SameSite=None; Secure; Path=/", source), true);
  assert.equal(await jar.setCookie("badnone=8; SameSite=None; Path=/", source), false);
  assert.equal(await jar.setCookie("wide=\u{1f36a}; Path=/", source), false);

  assert.equal(
    await jar.getCookieHeader("https://sub.example.test/app/deep"),
    "host=1; domain=2; secure=3; hidden=4; strict=5; lax=6; none=7",
  );
  assert.equal(await jar.getCookieHeader("https://other.example.test/app"), "domain=2");
  assert.equal(
    await jar.getCookieHeader("http://sub.example.test/app", { type: "non-http" }),
    "host=1; domain=2; strict=5; lax=6",
  );
  assert.equal(
    await jar.getCookieHeader(source, { sameSite: "cross-site", method: "POST" }),
    "none=7",
  );
  assert.equal(
    await jar.getCookieHeader(source, {
      sameSite: "cross-site",
      topLevelNavigation: true,
      method: "GET",
    }),
    "host=1; domain=2; secure=3; hidden=4; lax=6; none=7",
  );

  now += 1000;
  assert.equal(await jar.setCookie("short=1; Max-Age=1; Path=/", source), true);
  now += 1001;
  assert.equal((await jar.getCookieHeader(source)).includes("short=1"), false);
});

test("CookieJar enforces prefixes, public suffix policy and secure-overlay protection", async () => {
  const publicSuffixes = {
    isPublicSuffix(domain: string): boolean {
      return domain === "test" || domain === "example.test";
    },
  };
  const jar = new CookieJar({ publicSuffixes });
  assert.equal(
    await jar.setCookie("bad=1; Domain=test", "https://sub.example.test/account"),
    false,
  );
  assert.equal(
    await jar.setCookie("host=1; Domain=example.test", "https://example.test/account"),
    true,
  );
  assert.equal(await jar.setCookie("__Secure-a=1; Path=/", "https://example.test/account"), false);
  assert.equal(
    await jar.setCookie(
      "__Host-a=1; Secure; Path=/; Domain=sub.example.test",
      "https://sub.example.test/",
    ),
    false,
  );
  assert.equal(await jar.setCookie("__Host-a=1; Secure; Path=/", "https://example.test/"), true);
  assert.equal(
    await jar.setCookie("sid=secure; Secure; Path=/login", "https://example.test/"),
    true,
  );
  assert.equal(await jar.setCookie("sid=insecure; Path=/login/a", "http://example.test/"), false);
  assert.equal(await jar.setCookie("sid=other; Path=/", "http://example.test/"), true);
});

test("CookieJar preserves replacement order, evicts deterministically and persists only durable cookies", async () => {
  let now = 1_000;
  const store = new MemoryCookieJarStore();
  const jar = new CookieJar({
    wallTimeMilliseconds: () => now,
    store,
    maxCookiesPerDomain: 2,
    maxCookies: 3,
  });
  assert.equal(await jar.setCookie("deep=1; Path=/a/b", "https://one.test/a/b/c"), true);
  now++;
  assert.equal(await jar.setCookie("root=2; Path=/; Max-Age=60", "https://one.test/"), true);
  now++;
  assert.equal(await jar.setCookie("root=3; Path=/; Max-Age=60", "https://one.test/"), true);
  assert.equal(await jar.getCookieHeader("https://one.test/a/b/c"), "deep=1; root=3");
  now++;
  assert.equal(await jar.setCookie("third=4; Path=/", "https://one.test/"), true);
  assert.equal((await jar.snapshot()).length, 2);
  await jar.close();

  const restored = new CookieJar({ wallTimeMilliseconds: () => now, store });
  assert.equal(await restored.getCookieHeader("https://one.test/"), "root=3");
});

test("CookieJar serializes concurrent persistent updates without losing either cookie", async () => {
  const saved: string[][] = [];
  const store: CookieJarStore = {
    async loadAll() {
      return [];
    },
    async saveAll(cookies) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      saved.push(cookies.map((cookie) => cookie.name).sort());
    },
  };
  const jar = new CookieJar({ store });
  await Promise.all([
    jar.setCookie("a=1; Max-Age=60", "https://example.test/"),
    jar.setCookie("b=2; Max-Age=60", "https://example.test/"),
  ]);
  assert.deepEqual(saved, [["a"], ["a", "b"]]);
  assert.equal(await jar.getCookieHeader("https://example.test/"), "a=1; b=2");
});

test("CookieJar rolls back failed persistence and rejects corrupt snapshots", async () => {
  let saves = 0;
  const stored: StoredCookie[] = [];
  const store: CookieJarStore = {
    async loadAll() {
      return stored;
    },
    async saveAll(cookies) {
      saves++;
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (saves === 1) throw new Error("disk unavailable");
      stored.splice(0, stored.length, ...cookies);
    },
  };
  const jar = new CookieJar({ store });
  const failed = jar.setCookie("a=1; Max-Age=60", "https://example.test/");
  const following = jar.setCookie("b=2; Max-Age=60", "https://example.test/");
  await assert.rejects(failed, /disk unavailable/);
  assert.equal(await following, true);
  assert.equal(await jar.getCookieHeader("https://example.test/"), "b=2");

  const corrupt = new CookieJar({
    store: {
      async loadAll() {
        return [
          {
            name: "bad",
            value: "cookie",
            expiryTime: null,
            domain: "example.test",
            path: "/",
            creationTime: 0,
            lastAccessTime: 0,
            creationIndex: 0,
            persistent: true,
            hostOnly: true,
            secure: false,
            httpOnly: false,
            sameSite: "Default",
          },
        ];
      },
      async saveAll() {},
    },
  });
  await assert.rejects(corrupt.snapshot(), /invalid persistent cookie/);
});

test("CookieJar applies lifetime caps, default paths, replacement policy and PSL updates", async () => {
  let now = Date.UTC(2026, 0, 1);
  let exampleIsPublic = false;
  const jar = new CookieJar({
    wallTimeMilliseconds: () => now,
    publicSuffixes: {
      isPublicSuffix(domain: string): boolean {
        return exampleIsPublic && domain === "example.test";
      },
    },
  });
  assert.equal(await jar.setCookie("long=1; Max-Age=999999999", "https://example.test/a/b"), true);
  assert.equal((await jar.snapshot())[0]?.expiryTime, now + 400 * 24 * 60 * 60 * 1000);
  assert.equal(await jar.setCookie("path=2", "https://example.test/a/b"), true);
  assert.equal(await jar.getCookieHeader("https://example.test/a/c"), "long=1; path=2");
  assert.equal(await jar.getCookieHeader("https://example.test/ab"), "");

  assert.equal(
    await jar.setCookie(
      "gone=3; Expires=Wed, 09 Jun 2038 10:18:14 GMT; Max-Age=0",
      "https://example.test/",
    ),
    true,
  );
  assert.equal((await jar.getCookieHeader("https://example.test/")).includes("gone=3"), false);
  assert.equal(await jar.setCookie("http=4; HttpOnly", "https://example.test/"), true);
  assert.equal(await jar.setCookie("http=5", "https://example.test/", { type: "non-http" }), false);
  assert.equal(
    await jar.setCookie("cross=6; SameSite=Lax", "https://example.test/", {
      type: "non-http",
      sameSite: "cross-site",
      topLevelNavigation: true,
    }),
    false,
  );

  assert.equal(
    await jar.setCookie("domain=7; Domain=example.test", "https://sub.example.test/"),
    true,
  );
  exampleIsPublic = true;
  assert.equal(
    (await jar.getCookieHeader("https://sub.example.test/")).includes("domain=7"),
    false,
  );
  now++;
});

test("Fetch cookie policy stores redirect cookies, recomputes each hop and honors credentials", async () => {
  const jar = new CookieJar();
  const observed: { url: string; cookie: string | null }[] = [];
  let response = 0;
  const transport: FetchTransport = {
    async dispatch(request) {
      observed.push({
        url: request.url.href,
        cookie: request.headers.find((entry) => entry[0] === "cookie")?.[1] ?? null,
      });
      response++;
      if (response === 1) {
        return {
          status: 302,
          statusText: "Found",
          headers: [
            ["location", "/next"],
            ["set-cookie", "redirect=1; Path=/"],
          ],
          body: null,
        };
      }
      return {
        status: 200,
        statusText: "OK",
        headers: [
          ["set-cookie", "final=2; Path=/"],
          ["set-cookie", "other=3; Path=/next"],
        ],
        body: null,
      };
    },
  };
  const runtime = createHostNodeWebPlatform({
    fetchTransport: transport,
    cookies: new ServerCookiePolicy(jar),
  });
  const result = await runtime.fetch("https://example.test/start", { credentials: "include" });
  assert.equal(result.status, 200);
  assert.deepEqual(observed, [
    { url: "https://example.test/start", cookie: null },
    { url: "https://example.test/next", cookie: "redirect=1" },
  ]);
  assert.equal(
    await jar.getCookieHeader("https://example.test/next"),
    "other=3; redirect=1; final=2",
  );

  observed.length = 0;
  response = 2;
  await runtime.fetch("https://example.test/explicit", {
    credentials: "include",
    headers: { cookie: "caller=4" },
  });
  assert.equal(observed[0]?.cookie, "caller=4");

  observed.length = 0;
  await runtime.fetch("https://example.test/omit", { credentials: "omit" });
  assert.equal(observed[0]?.cookie, null);
});

test("same-origin Fetch credentials do not leak jar state across an origin redirect", async () => {
  const jar = new CookieJar();
  await jar.setCookie("one=1; Secure; Path=/", "https://one.test/");
  await jar.setCookie("two=2; Secure; Path=/", "https://two.test/");
  const observed: (string | null)[] = [];
  const transport: FetchTransport = {
    async dispatch(request) {
      observed.push(request.headers.find((entry) => entry[0] === "cookie")?.[1] ?? null);
      if (request.url.hostname === "one.test") {
        return {
          status: 302,
          statusText: "Found",
          headers: [["location", "https://two.test/final"]],
          body: null,
        };
      }
      return {
        status: 200,
        statusText: "OK",
        headers: [["set-cookie", "not-stored=3; Secure; Path=/"]],
        body: null,
      };
    },
  };
  const runtime = createHostNodeWebPlatform({
    fetchTransport: transport,
    cookies: new ServerCookiePolicy(jar),
  });
  await runtime.fetch("https://one.test/start");
  assert.deepEqual(observed, ["one=1", null]);
  assert.equal(await jar.getCookieHeader("https://two.test/"), "two=2");
});
