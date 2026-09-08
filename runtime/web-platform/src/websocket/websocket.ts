import { AbortController } from "../core/abort.ts";
import type { EventHandlerSlot } from "../core/events.ts";
import { Event, EventTarget, MessageEvent, CloseEvent } from "../core/events.ts";
import { DOMException, LimitError } from "../core/errors.ts";
import { checkNetworkPort } from "../core/network-port.ts";
import { utf8Length } from "../core/utf8.ts";
import { requireArguments, toUSVString } from "../core/webidl.ts";
import { currentWebPlatformRuntime } from "../provider/environment.ts";
import type { Scheduler, URLParser, URLRecord } from "../provider/primitives.ts";
import { Blob } from "../file/blob.ts";
import {
  normalizeWebSocketCloseArguments,
  normalizeWebSocketProtocols,
  normalizeWebSocketURL,
} from "./semantics.ts";
import type {
  SocketClose,
  SocketMessage,
  WebSocketSession,
  WebSocketTransport,
} from "./transport.ts";
import {
  eventTargetSetErrorReporter,
  eventTargetSetHandler,
} from "../core/events.ts";

export type WebSocketData = string | Blob | ArrayBuffer;

export type WebSocketSendData = string | Blob | ArrayBuffer | ArrayBufferView;

export interface WebSocketContext {
  urls: URLParser;
  scheduler: Scheduler;
  transport: WebSocketTransport;
  baseURL?: string;
  origin?: string;
  maxBufferedAmount?: number;
  registerWebSocket(socket: WebSocket): void;
  unregisterWebSocket(socket: WebSocket): void;
}

interface PendingSend {
  size: number;
  value: string | Blob | Uint8Array;
}

const webSocketConstructorKey: unique symbol = Symbol("construct NTS WebSocket");

export class WebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readonly url: string;
  private state = 0;
  private amount = 0;
  private chosenProtocol = "";
  private negotiatedExtensions = "";
  private binary: "blob" | "arraybuffer" = "blob";
  private readonly context: WebSocketContext;
  private readonly controller = new AbortController();
  private session: WebSocketSession | null = null;
  private sends: Promise<void> = Promise.resolve();
  private closeQueued = false;
  private registered = false;
  private readonly openHandler: EventHandlerSlot<WebSocket, Event> = {
    callback: null,
    listener: null,
  };
  private readonly errorHandler: EventHandlerSlot<WebSocket, Event> = {
    callback: null,
    listener: null,
  };
  private readonly messageHandler: EventHandlerSlot<WebSocket, MessageEvent<WebSocketData>> = {
    callback: null,
    listener: null,
  };
  private readonly closeHandler: EventHandlerSlot<WebSocket, CloseEvent> = {
    callback: null,
    listener: null,
  };

  get onopen(): ((this: WebSocket, event: Event) => void) | null {
    return this.openHandler.callback;
  }

  set onopen(callback: ((this: WebSocket, event: Event) => void) | null) {
    this[eventTargetSetHandler](this, this.openHandler, "open", callback, (_event): _event is Event => true);
  }

  get onerror(): ((this: WebSocket, event: Event) => void) | null {
    return this.errorHandler.callback;
  }

  set onerror(callback: ((this: WebSocket, event: Event) => void) | null) {
    this[eventTargetSetHandler](this, this.errorHandler, "error", callback, (_event): _event is Event => true);
  }

  get onmessage(): ((this: WebSocket, event: MessageEvent<WebSocketData>) => void) | null {
    return this.messageHandler.callback;
  }

  set onmessage(callback: ((this: WebSocket, event: MessageEvent<WebSocketData>) => void) | null) {
    this[eventTargetSetHandler](this, this.messageHandler, "message", callback, isSocketMessageEvent);
  }

  get onclose(): ((this: WebSocket, event: CloseEvent) => void) | null {
    return this.closeHandler.callback;
  }

  set onclose(callback: ((this: WebSocket, event: CloseEvent) => void) | null) {
    this[eventTargetSetHandler](
      this,
      this.closeHandler,
      "close",
      callback,
      (event): event is CloseEvent => event instanceof CloseEvent,
    );
  }

  constructor(url: string, protocols?: string | readonly string[]);
  /** @internal Reached only through {@link createInternalWebSocket}. */ constructor(
    url: string,
    protocols: string | readonly string[] | undefined,
    key: typeof webSocketConstructorKey,
    context: WebSocketContext,
  );
  constructor(
    ...args: [
      url: string,
      protocols?: string | readonly string[],
      key?: typeof webSocketConstructorKey,
      context?: WebSocketContext,
    ]
  ) {
    requireArguments(args, 1, "WebSocket constructor");
    // The public API is `(url, protocols)`. Surplus arguments are ignored because the
    // construction key is module-private and therefore unforgeable by script, so a
    // caller cannot substitute the transports, proxy policy or scheduler in use.
    const supplied = args[3];
    const context =
      args[2] === webSocketConstructorKey && supplied !== undefined
        ? supplied
        : currentWebPlatformRuntime();
    super();
    this[eventTargetSetErrorReporter]((error) => context.scheduler.reportError(error));
    this.context = context;
    if (
      context.maxBufferedAmount !== undefined &&
      (!Number.isSafeInteger(context.maxBufferedAmount) || context.maxBufferedAmount < 1)
    ) {
      throw new RangeError("Invalid WebSocket buffer limit");
    }
    const parsed = normalizeWebSocketURL(args[0], context);
    const offers = normalizeWebSocketProtocols(args[1] ?? []);
    this.url = parsed.href;
    context.registerWebSocket(this);
    this.registered = true;
    this.connect(parsed, offers).catch((error) => this.fail(error));
  }

  get readyState(): number {
    return this.state;
  }

  get bufferedAmount(): number {
    return this.amount;
  }

  get protocol(): string {
    return this.chosenProtocol;
  }

  get extensions(): string {
    return this.negotiatedExtensions;
  }

  get binaryType(): "blob" | "arraybuffer" {
    return this.binary;
  }

  set binaryType(value: "blob" | "arraybuffer") {
    if (value === "blob" || value === "arraybuffer") this.binary = value;
  }
  private async connect(url: URLRecord, protocols: readonly string[]): Promise<void> {
    checkNetworkPort(url.port);
    const session = await this.context.transport.connect(
      { url, protocols, origin: this.context.origin ?? "null" },
      this.controller.signal,
    );
    this.context.scheduler.enqueue(() => {
      if (this.state !== this.CONNECTING) {
        session.abort();
        this.fail(new DOMException("Closed while connecting", "AbortError"));
        return;
      }
      this.session = session;
      this.state = this.OPEN;
      this.chosenProtocol = session.protocol;
      this.negotiatedExtensions = session.extensions;
      const event = new Event("open");
      this.dispatchEvent(event);
      this.readLoop(session).catch((error) => this.fail(error));
    });
  }
  private async readLoop(session: WebSocketSession): Promise<void> {
    while (this.state !== this.CLOSED && !this.closeQueued) {
      const incoming = await session.next();
      if (incoming.kind === "close") {
        this.finish(incoming);
        return;
      }
      // A task per message, awaited before the next read, bounds the event backlog.
      await new Promise<void>((resolve) =>
        this.context.scheduler.enqueue(() => {
          try {
            if (this.state !== this.OPEN) return;
            let data: WebSocketData;
            if (incoming.kind === "text") data = incoming.data;
            else if (this.binary === "blob") data = new Blob([incoming.data]);
            else {
              const buffer = new ArrayBuffer(incoming.data.length);
              new Uint8Array(buffer).set(incoming.data);
              data = buffer;
            }
            const event = new MessageEvent<WebSocketData>("message", {
              data,
              origin: this.context.urls.parse(this.url).origin,
            });
            this.dispatchEvent(event);
          } finally {
            resolve();
          }
        }),
      );
    }
  }

  send(data: WebSocketSendData): void {
    if (this.state === this.CONNECTING)
      throw new DOMException("WebSocket is still connecting", "InvalidStateError");
    let pending: PendingSend;
    if (typeof data === "string") {
      const value = toUSVString(data);
      pending = { value, size: utf8Length(value) };
    } else if (data instanceof Blob) pending = { value: data, size: data.size };
    else {
      const source =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const bytes = source.slice();
      pending = { value: bytes, size: bytes.length };
    }
    this.amount += pending.size;
    if (this.state !== this.OPEN) return;
    if (this.amount > (this.context.maxBufferedAmount ?? 16 * 1024 * 1024)) {
      this.fail(new LimitError("WebSocket send buffer is full"));
      return;
    }
    this.sends = this.sends.then(async () => {
      if (this.closeQueued || this.state === this.CLOSED) return;
      const session = this.session;
      if (session === null)
        throw new DOMException("WebSocket is not connected", "InvalidStateError");
      const message: SocketMessage =
        typeof pending.value === "string"
          ? { kind: "text", data: pending.value }
          : {
              kind: "binary",
              data: pending.value instanceof Blob ? await pending.value.bytes() : pending.value,
            };
      await session.send(message);
      this.context.scheduler.enqueue(() => {
        this.amount -= pending.size;
      });
    });
    this.sends.catch((error) => this.fail(error));
  }

  close(code?: number, reason = ""): void {
    const close = normalizeWebSocketCloseArguments(code, reason);
    if (this.state === this.CLOSING || this.state === this.CLOSED) return;
    if (this.state === this.CONNECTING) {
      this.state = this.CLOSING;
      this.controller.abort();
      this.fail(new DOMException("Closed while connecting", "AbortError"));
      return;
    }
    this.state = this.CLOSING;
    this.sends
      .then(() => this.session?.close(close.closeCode, close.reason))
      .catch((error) => this.fail(error));
  }
  /** @internal */ closeForRuntime(): void {
    if (this.state === this.CLOSED) return;
    this.controller.abort();
    this.session?.abort();
    this.finish({ kind: "close", code: 1006, reason: "", wasClean: false, failed: true });
  }
  private fail(_error: unknown): void {
    this.controller.abort();
    this.session?.abort();
    this.finish({ kind: "close", code: 1006, reason: "", wasClean: false, failed: true });
  }
  private finish(info: SocketClose): void {
    if (this.closeQueued || this.state === this.CLOSED) return;
    this.closeQueued = true;
    this.context.scheduler.enqueue(() => {
      this.state = this.CLOSED;
      this.unregister();
      if (info.failed) {
        const error = new Event("error");
        this.dispatchEvent(error);
      }
      const close = new CloseEvent("close", {
        code: info.code,
        reason: info.reason,
        wasClean: info.wasClean,
      });
      this.dispatchEvent(close);
    });
  }

  private unregister(): void {
    if (!this.registered) return;
    this.registered = false;
    this.context.unregisterWebSocket(this);
  }

  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "WebSocket",
      writable: false,
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(this, "length", {
      value: 1,
      writable: false,
      enumerable: false,
      configurable: true,
    });
  }
}

function isSocketMessageEvent(event: Event): event is MessageEvent<WebSocketData> {
  if (!(event instanceof MessageEvent)) return false;
  const data: unknown = event.data;
  return typeof data === "string" || data instanceof Blob || data instanceof ArrayBuffer;
}

/**
 * @internal Construct a WebSocket owned by an explicit runtime.
 *
 * The capability travels through this module-private factory rather than a public
 * constructor argument, so script cannot supply it as a surplus argument.
 */
export function createInternalWebSocket(
  url: string,
  protocols: string | readonly string[] | undefined,
  context: WebSocketContext,
): WebSocket {
  return new WebSocket(url, protocols, webSocketConstructorKey, context);
}
