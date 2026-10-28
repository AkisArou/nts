// Supplemental API controls for protocol interoperability and close conversion.
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { DOMException, WebSocket, WebSocketStream } from "../src/index.ts";
import type {
  SocketIncoming,
  SocketMessage,
  WebSocketHandshake,
  WebSocketSession,
} from "../src/websocket/transport.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, { timeout: 60_000 }, fn);
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
