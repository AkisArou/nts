// Supplemental API controls for protocol interoperability and close conversion.
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { DOMException, WebSocket, WebSocketError, WebSocketStream } from "../src/index.ts";
import type { NormalizedWebSocketClose } from "../src/websocket/semantics.ts";
import type {
  SocketIncoming,
  SocketMessage,
  WebSocketHandshake,
  WebSocketSession,
} from "../src/websocket/transport.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, fn);
};

type SocketKind = "WebSocket" | "WebSocketStream";

class PolicySession implements WebSocketSession {
  readonly protocol: string;
  readonly extensions = "";
  readonly closes: { code: number | null; reason: string }[] = [];
  private readonly incoming = Promise.withResolvers<SocketIncoming>();

  constructor(protocol: string) {
    this.protocol = protocol;
  }

  next(): Promise<SocketIncoming> {
    return this.incoming.promise;
  }

  send(_message: SocketMessage): Promise<void> {
    return assert.fail("these controls send no application messages");
  }

  close(code: number | null, reason: string): Promise<void> {
    this.closes.push({ code, reason });
    this.incoming.resolve({ kind: "close", code: code ?? 1005, reason, wasClean: true, failed: false });
    return Promise.resolve();
  }

  abort(): void {
    this.incoming.resolve({ kind: "close", code: 1006, reason: "", wasClean: false, failed: true });
  }
}

function controlledRuntime(t: TestContext) {
  const handshakes: WebSocketHandshake[] = [];
  const sessions: PolicySession[] = [];
  const errors: unknown[] = [];
  const runtime = createHostNodeWebPlatform({
    webSocketTransport: {
      connect(handshake) {
        handshakes.push(handshake);
        const session = new PolicySession(handshake.protocols[0] ?? "");
        sessions.push(session);
        return Promise.resolve(session);
      },
    },
  }, {}, (error) => errors.push(error));
  t.after(async () => {
    runtime.close();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(errors, []);
  });
  return { handshakes, sessions };
}

function construct(kind: SocketKind, protocols: readonly string[]): void {
  if (kind === "WebSocket") new WebSocket("ws://example.test/socket", protocols);
  else new WebSocketStream("ws://example.test/socket", { protocols });
}

function syntaxError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "SyntaxError";
}

// WebSockets 3.1 and Web IDL 3.2.25: DOMString or sequence<DOMString>.
// https://websockets.spec.whatwg.org/#dom-websocket
// https://webidl.spec.whatwg.org/#es-union
// https://webidl.spec.whatwg.org/#create-sequence-from-iterable
const JavaScriptWebSocket = WebSocket as new (url: string, protocols?: unknown) => WebSocket;

suite("WebSocket protocols retain omitted, undefined, string and sequence controls", (t) => {
  const { handshakes } = controlledRuntime(t);
  new WebSocket("ws://example.test/socket");
  new JavaScriptWebSocket("ws://example.test/socket", undefined);
  new WebSocket("ws://example.test/socket", "Chat");
  new WebSocket("ws://example.test/socket", ["Chat", "Other"]);
  assert.deepEqual(handshakes.map((handshake) => handshake.protocols), [
    [], [], ["Chat"], ["Chat", "Other"],
  ]);
});

for (const [label, value, expected] of [
  ["explicit null", null, "null"],
  ["number", 17, "17"],
  ["boolean", true, "true"],
  ["bigint", 23n, "23"],
] as const) {
  suite(`WebSocket protocols convert ${label} to a single DOMString`, (t) => {
    const { handshakes } = controlledRuntime(t);
    new JavaScriptWebSocket("ws://example.test/socket", value);
    assert.deepEqual(handshakes.map((handshake) => handshake.protocols), [[expected]]);
  });
}

suite("WebSocket protocols convert an ordinary stringifiable object once", (t) => {
  const { handshakes } = controlledRuntime(t);
  let conversions = 0;
  new JavaScriptWebSocket("ws://example.test/socket", {
    toString() {
      conversions++;
      return "Chat";
    },
  });
  assert.equal(conversions, 1);
  assert.deepEqual(handshakes.map((handshake) => handshake.protocols), [["Chat"]]);
});

suite("WebSocket protocols use string fallback for a null or undefined iterator method", (t) => {
  const { handshakes } = controlledRuntime(t);
  for (const method of [null, undefined]) {
    const observations: string[] = [];
    new JavaScriptWebSocket("ws://example.test/socket", {
      get [Symbol.iterator]() {
        observations.push("iterator");
        return method;
      },
      toString() {
        observations.push("toString");
        return "Chat";
      },
    });
    assert.deepEqual(observations, ["iterator", "toString"]);
  }
  assert.deepEqual(handshakes.map((handshake) => handshake.protocols), [["Chat"], ["Chat"]]);
});

suite("WebSocket protocols capture iterator and next methods once with their receivers", (t) => {
  const { handshakes } = controlledRuntime(t);
  const observations: string[] = [];
  let index = 0;
  const iterator = {
    get next() {
      observations.push("get next");
      return function (this: unknown): IteratorResult<unknown> {
        assert.equal(this, iterator);
        observations.push("next");
        if (index++ === 0) {
          return { done: false, value: { toString() { observations.push("convert"); return "Chat"; } } };
        }
        return { done: true, get value(): never { return assert.fail("done skips value"); } };
      };
    },
  };
  const protocols = {
    get [Symbol.iterator]() {
      observations.push("get iterator");
      return function (this: unknown) {
        assert.equal(this, protocols);
        observations.push("iterator");
        return iterator;
      };
    },
    toString(): never { return assert.fail("the iterable branch must not stringify its container"); },
  };
  new JavaScriptWebSocket("ws://example.test/socket", protocols);
  assert.deepEqual(observations, ["get iterator", "iterator", "get next", "next", "convert", "next"]);
  assert.deepEqual(handshakes.map((handshake) => handshake.protocols), [["Chat"]]);
});

suite("WebSocket protocol conversion propagates string and iterator failures before connecting", (t) => {
  const { handshakes } = controlledRuntime(t);
  const failure = new Error("protocol conversion");
  assert.throws(() => new JavaScriptWebSocket("ws://example.test/socket", Symbol("protocol")), TypeError);
  for (const protocols of [
    { toString() { throw failure; } },
    { get [Symbol.iterator](): never { throw failure; } },
    { [Symbol.iterator]() { throw failure; } },
  ]) {
    assert.throws(() => new JavaScriptWebSocket("ws://example.test/socket", protocols),
      (error: unknown) => error === failure);
  }
  for (const protocols of [
    { [Symbol.iterator]: 17, toString: () => "Chat" },
    { [Symbol.iterator]: () => null },
    { [Symbol.iterator]: () => ({ next: 17 }) },
    { [Symbol.iterator]: () => ({ next: () => null }) },
  ]) assert.throws(() => new JavaScriptWebSocket("ws://example.test/socket", protocols), TypeError);
  assert.deepEqual(handshakes, []);
});

suite("WebSocket protocol sequence conversion finishes before token validation without IteratorClose", (t) => {
  const { handshakes } = controlledRuntime(t);
  const failure = new Error("later element conversion");
  let returns = 0;
  let nexts = 0;
  const protocols = {
    [Symbol.iterator]() {
      return {
        next(): IteratorResult<unknown> {
          nexts++;
          if (nexts === 1) return { done: false, value: "invalid token" };
          return { done: false, value: { toString() { throw failure; } } };
        },
        return(): IteratorResult<unknown> {
          returns++;
          return { done: true, value: undefined };
        },
      };
    },
  };
  assert.throws(() => new JavaScriptWebSocket("ws://example.test/socket", protocols),
    (error: unknown) => error === failure);
  assert.equal(nexts, 2);
  assert.equal(returns, 0);
  assert.deepEqual(handshakes, []);
});

suite("WebSocket converts URL then protocols before parsing the URL", (t) => {
  const { handshakes } = controlledRuntime(t);
  const observations: string[] = [];
  const Constructor = WebSocket as new (url: unknown, protocols: unknown) => WebSocket;
  assert.throws(() => new Constructor({
    toString() { observations.push("url"); return "not an absolute URL"; },
  }, {
    toString() { observations.push("protocols"); return "Chat"; },
  }), syntaxError);
  assert.deepEqual(observations, ["url", "protocols"]);
  assert.deepEqual(handshakes, []);
});

suite("WebSocket converted protocol elements retain ASCII-insensitive duplicate rejection", (t) => {
  const { handshakes } = controlledRuntime(t);
  assert.throws(() => new JavaScriptWebSocket("ws://example.test/socket", [
    { toString: () => "Chat" }, { toString: () => "cHAT" },
  ]), syntaxError);
  assert.deepEqual(handshakes, []);
});

suite("WebSocketStream protocols remain sequence-only when WebSocket accepts string fallback", (t) => {
  const { handshakes } = controlledRuntime(t);
  const Constructor = WebSocketStream as new (url: string, options: { protocols: unknown }) => WebSocketStream;
  for (const protocols of ["Chat", null, 17, { toString: () => "Chat" }, {
    [Symbol.iterator]: null, toString: () => "Chat",
  }]) assert.throws(() => new Constructor("ws://example.test/socket", { protocols }), TypeError);
  assert.deepEqual(handshakes, []);
});

// WHATWG WebSockets 3.1 constructor step 9 says values must not repeat.
// ASCII-insensitive comparison is the selected interop policy, not an explicit
// case-folding requirement in that wording. The original offer is preserved.
for (const kind of ["WebSocket", "WebSocketStream"] as const) {
  suite(`${kind} rejects ASCII-case variants of a repeated protocol`, (t) => {
    const { handshakes } = controlledRuntime(t);
    for (const protocols of [
      ["echo", "eCho"],
      ["ECHO", "echo"],
      ["chat", "other", "CHAT"],
      ["X!a", "x!A"],
    ]) assert.throws(() => construct(kind, protocols), syntaxError);
    assert.deepEqual(handshakes, [], "validation finishes before the provider is called");
  });

  suite(`${kind} still rejects exactly repeated protocols`, (t) => {
    const { handshakes } = controlledRuntime(t);
    assert.throws(() => construct(kind, ["echo", "echo"]), syntaxError);
    assert.throws(() => construct(kind, ["123", "123"]), syntaxError);
    assert.deepEqual(handshakes, []);
  });

  suite(`${kind} rejects invalid protocol tokens before duplicate comparison`, (t) => {
    const { handshakes } = controlledRuntime(t);
    for (const token of ["", "with space", "écho", "echo,chat", "\u007f"])
      assert.throws(() => construct(kind, [token]), syntaxError);
    assert.deepEqual(handshakes, []);
  });

  suite(`${kind} preserves distinct offered tokens and their original casing`, async (t) => {
    const { handshakes } = controlledRuntime(t);
    const protocols = ["EcHo", "Echo.V2", "Echo-V2", "123", "!#$%&'*+.^_`|~"];
    const expected = protocols.slice();
    if (kind === "WebSocket") {
      const socket = new WebSocket("ws://example.test/socket", protocols);
      const closed = new Promise<void>((resolve) => socket.addEventListener("close", () => resolve(), { once: true }));
      await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve(), { once: true }));
      assert.equal(socket.protocol, "EcHo");
      socket.close(1000);
      await closed;
    } else {
      const stream = new WebSocketStream("ws://example.test/socket", { protocols });
      assert.equal((await stream.opened).protocol, "EcHo");
      stream.close({ closeCode: 1000 });
      await stream.closed;
    }
    assert.equal(handshakes.length, 1);
    const handshake = handshakes[0];
    assert.ok(handshake);
    assert.deepEqual(handshake.protocols, expected);
    assert.deepEqual(protocols, expected, "the caller's array is unchanged");
  });
}

// JavaScript callers may provide values outside the convenient TypeScript type.
interface JavaScriptCloseInfo {
  closeCode?: number;
  reason?: unknown;
}

type CloseConsumer = "WebSocketStream" | "WebSocketError";

function closeStream(stream: WebSocketStream, options?: JavaScriptCloseInfo | null): void {
  const close = stream.close as (this: WebSocketStream, options?: JavaScriptCloseInfo | null) => void;
  close.call(stream, options);
}

async function convertCloseInfo(
  t: TestContext,
  consumer: CloseConsumer,
  options?: JavaScriptCloseInfo | null,
): Promise<NormalizedWebSocketClose> {
  if (consumer === "WebSocketError") {
    const ErrorConstructor = WebSocketError as new (
      message?: string,
      options?: JavaScriptCloseInfo | null,
    ) => WebSocketError;
    const error = new ErrorConstructor("control", options);
    return { closeCode: error.closeCode, reason: error.reason };
  }
  const { sessions } = controlledRuntime(t);
  const stream = new WebSocketStream("ws://example.test/socket");
  await stream.opened;
  closeStream(stream, options);
  const closed = await stream.closed;
  const session = sessions[0];
  assert.ok(session);
  assert.equal(session.closes.length, 1);
  const sent = session.closes[0];
  assert.ok(sent);
  assert.deepEqual(closed, { closeCode: sent.code ?? 1005, reason: sent.reason });
  return { closeCode: sent.code, reason: sent.reason };
}

// Web IDL 3.2.17 steps 4.1.3–4.1.5: only undefined selects a dictionary default.
// USVString follows 3.2.10/3.2.12. Draft PR 48 sections 4, 4.3 and 5 validate
// the converted reason and choose close code 1000 for a reason without a code.
for (const consumer of ["WebSocketStream", "WebSocketError"] as const) {
  suite(`${consumer} converts an explicit null close reason to USVString`, async (t) => {
    assert.deepEqual(await convertCloseInfo(t, consumer, { reason: null }), {
      closeCode: 1000, reason: "null",
    });
    assert.deepEqual(await convertCloseInfo(t, consumer, { closeCode: 3001, reason: null }), {
      closeCode: 3001, reason: "null",
    });
  });

  suite(`${consumer} retains the empty reason default for omitted and undefined members`, async (t) => {
    for (const options of [undefined, null, {}, { reason: undefined }, { reason: "" }]) {
      assert.deepEqual(await convertCloseInfo(t, consumer, options), {
        closeCode: null, reason: "",
      });
    }
  });

  suite(`${consumer} reads the null reason getter once after closeCode`, async (t) => {
    const reads: string[] = [];
    const result = await convertCloseInfo(t, consumer, {
      get closeCode(): undefined {
        reads.push("closeCode");
        return undefined;
      },
      get reason(): null {
        reads.push("reason");
        return null;
      },
    });
    assert.deepEqual(reads, ["closeCode", "reason"]);
    assert.deepEqual(result, { closeCode: 1000, reason: "null" });
  });
}

suite("WebSocket.close also distinguishes explicit null from an undefined reason", async (t) => {
  const { sessions } = controlledRuntime(t);
  for (const reason of [null, undefined]) {
    const socket = new WebSocket("ws://example.test/socket");
    const closed = new Promise<void>((resolve) => socket.addEventListener("close", () => resolve(), { once: true }));
    await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve(), { once: true }));
    const close = socket.close as (this: WebSocket, code?: number, reason?: unknown) => void;
    close.call(socket, undefined, reason);
    await closed;
  }
  assert.deepEqual(sessions.map((session) => session.closes), [
    [{ code: 1000, reason: "null" }],
    [{ code: null, reason: "" }],
  ]);
});
