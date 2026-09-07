import { AbortController, AbortSignal } from "../core/abort.ts";
import { DOMException } from "../core/errors.ts";
import { checkNetworkPort } from "../core/network-port.ts";
import { ignoreRejection } from "../core/promise.ts";
import { coerceToDOMString, requireArguments, requireDictionary } from "../core/webidl.ts";
import { currentWebPlatformRuntime } from "../provider/environment.ts";
import type { URLRecord } from "../provider/primitives.ts";
import { ReadableStream, type ReadableStreamDefaultController } from "../streams/readable.ts";
import { WritableStream, type WritableStreamDefaultController } from "../streams/writable.ts";
import {
  normalizeWebSocketCloseInfo,
  normalizeWebSocketProtocols,
  normalizeWebSocketURL,
  type NormalizedWebSocketClose,
  type WebSocketCloseInfo,
  type WebSocketURLContext,
} from "./semantics.ts";
import type {
  SocketClose,
  SocketMessage,
  WebSocketSession,
  WebSocketTransport,
} from "./transport.ts";

export type { WebSocketCloseInfo } from "./semantics.ts";

export type WebSocketStreamData = string | Uint8Array;

export type WebSocketStreamSendData = string | ArrayBuffer | ArrayBufferView;

export interface WebSocketStreamOptions {
  protocols?: Iterable<string>;
  signal?: AbortSignal;
}

export interface WebSocketOpenInfo {
  readonly readable: ReadableStream<WebSocketStreamData>;
  readonly writable: WritableStream<unknown>;
  readonly extensions: string;
  readonly protocol: string;
}

export interface WebSocketStreamContext extends WebSocketURLContext {
  readonly transport: WebSocketTransport;
  readonly origin?: string;
  registerWebSocketStream(stream: WebSocketStream): void;
  unregisterWebSocketStream(stream: WebSocketStream): void;
}

const internalErrorKey: unique symbol = Symbol("construct internal WebSocketError");

interface InternalErrorInit {
  readonly closeCode: number | null;
  readonly key: typeof internalErrorKey;
  readonly reason: string;
}

/** The error type used by the WebSocketStream proposal. */
export class WebSocketError extends DOMException {
  readonly closeCode: number | null;
  readonly reason: string;

  constructor(message?: string, options?: WebSocketCloseInfo | null);
  /** @internal */ constructor(
    message: string,
    options: WebSocketCloseInfo | null | undefined,
    internal: InternalErrorInit,
  );
  constructor(
    ...args: [message?: string, options?: WebSocketCloseInfo | null, internal?: InternalErrorInit]
  ) {
    super(coerceToDOMString(args[0] ?? ""), "WebSocketError");
    const internal = args[2];
    if (internal?.key === internalErrorKey) {
      this.closeCode = internal.closeCode;
      this.reason = internal.reason;
      return;
    }
    const close = normalizeWebSocketCloseInfo(args[1]);
    this.closeCode = close.closeCode;
    this.reason = close.reason;
  }
}

type ConnectionState = "connecting" | "open" | "closing" | "closed";
type CloseOrigin = "public" | "readable-cancel" | "writable-abort" | "writable-close";

const webSocketStreamConstructorKey: unique symbol = Symbol("construct NTS WebSocketStream");

/** A backpressure-aware WebSocket exposed as a readable/writable stream pair. */
export class WebSocketStream {
  readonly url: string;
  readonly opened: Promise<WebSocketOpenInfo>;
  readonly closed: Promise<WebSocketCloseInfo>;

  readonly #context: WebSocketStreamContext;
  readonly #connectionController = new AbortController();
  readonly #openedCapability = Promise.withResolvers<WebSocketOpenInfo>();
  readonly #closedCapability = Promise.withResolvers<WebSocketCloseInfo>();
  readonly #closeCapability = Promise.withResolvers<void>();
  #state: ConnectionState = "connecting";
  #session: WebSocketSession | null = null;
  #readable: ReadableStream<WebSocketStreamData> | null = null;
  #writable: WritableStream<unknown> | null = null;
  #readableController: ReadableStreamDefaultController<WebSocketStreamData> | null = null;
  #writableController: WritableStreamDefaultController<unknown> | null = null;
  #removeAbortAlgorithm: (() => void) | null = null;
  #readInFlight = false;
  #readableTerminal = false;
  #writableTerminal = false;
  #closeOrigin: CloseOrigin | null = null;
  #pendingWrites = 0;
  #hasUnwrittenData = false;
  #terminalWriteError: unknown = null;
  #registered = false;

  constructor(url: string, options?: WebSocketStreamOptions | null);
  /** @internal Reached only through {@link createInternalWebSocketStream}. */ constructor(
    url: string,
    options: WebSocketStreamOptions | null | undefined,
    key: typeof webSocketStreamConstructorKey,
    context: WebSocketStreamContext,
  );
  constructor(
    ...args: [
      url: string,
      options?: WebSocketStreamOptions | null,
      key?: typeof webSocketStreamConstructorKey,
      context?: WebSocketStreamContext,
    ]
  ) {
    requireArguments(args, 1, "WebSocketStream constructor");
    requireDictionary(args[1], "WebSocketStream options");
    // The public API is `(url, options)`. Surplus arguments are ignored because the
    // construction key is module-private and therefore unforgeable by script, so a
    // caller cannot substitute the transports, proxy policy or scheduler in use.
    const supplied = args[3];
    const context =
      args[2] === webSocketStreamConstructorKey && supplied !== undefined
        ? supplied
        : currentWebPlatformRuntime();
    const parsed = normalizeWebSocketURL(args[0], context);
    const protocols = readProtocols(args[1]?.protocols);
    const signal = args[1]?.signal;
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      throw new TypeError("WebSocketStream signal must be an AbortSignal");
    }

    this.url = parsed.href;
    this.opened = this.#openedCapability.promise;
    this.closed = this.#closedCapability.promise;
    this.#context = context;
    ignoreRejection(this.opened);
    ignoreRejection(this.closed);
    ignoreRejection(this.#closeCapability.promise);
    context.registerWebSocketStream(this);
    this.#registered = true;

    if (signal?.aborted) {
      this.#failBeforeOpen(signal.reason);
      return;
    }
    if (signal !== undefined) {
      this.#removeAbortAlgorithm = signal.subscribe(() => {
        if (this.#state !== "connecting") return;
        this.#connectionController.abort(signal.reason);
        this.#failBeforeOpen(signal.reason);
      });
    }
    this.#connect(parsed, protocols).catch((error) => {
      if (this.#state === "connecting") this.#failBeforeOpen(connectionError(error));
    });
  }

  close(options?: WebSocketCloseInfo | null): void {
    const close = normalizeWebSocketCloseInfo(options);
    this.#beginClose(close, "public");
  }

  /** @internal */ closeForRuntime(): void {
    if (this.#state === "closed") return;
    const error = createConnectionError("Web-platform runtime is closed", {
      closeCode: 1006,
      reason: "",
    });
    this.#connectionController.abort(error);
    this.#session?.abort();
    this.#finishFailure(error);
  }

  async #connect(url: URLRecord, protocols: readonly string[]): Promise<void> {
    checkNetworkPort(url.port);
    const session = await this.#context.transport.connect(
      { url, protocols, origin: this.#context.origin ?? "null" },
      this.#connectionController.signal,
    );
    if (this.#state !== "connecting") {
      session.abort();
      return;
    }
    this.#removeAbortAlgorithm?.();
    this.#removeAbortAlgorithm = null;
    this.#session = session;
    this.#state = "open";
    this.#createStreams();
    const readable = this.#readable;
    const writable = this.#writable;
    if (readable === null || writable === null) {
      throw new Error("WebSocketStream failed to create its streams");
    }
    this.#openedCapability.resolve({
      readable,
      writable,
      extensions: session.extensions,
      protocol: session.protocol,
    });
  }

  #createStreams(): void {
    const owner = this;
    this.#readable = new ReadableStream<WebSocketStreamData>(
      {
        start(controller) {
          owner.#readableController = controller;
        },
        pull() {
          return owner.#pull();
        },
        cancel(reason) {
          return owner.#cancelReadable(reason);
        },
      },
      { highWaterMark: 1 },
    );
    this.#writable = new WritableStream<unknown>(
      {
        start(controller) {
          owner.#writableController = controller;
        },
        write(chunk) {
          return owner.#write(chunk);
        },
        close() {
          return owner.#closeWritable();
        },
        abort(reason) {
          return owner.#abortWritable(reason);
        },
      },
      { highWaterMark: 1 },
    );
  }

  async #pull(): Promise<void> {
    if (this.#state !== "open" || this.#readInFlight) return;
    await this.#receive(true);
  }

  async #receive(deliverMessage: boolean): Promise<void> {
    const session = this.#session;
    if (session === null || this.#state === "closed" || this.#readInFlight) return;
    this.#readInFlight = true;
    try {
      while (!this.#isClosed()) {
        const incoming = await session.next();
        if (incoming.kind === "close") {
          this.#finishFromPeer(incoming);
          return;
        }
        if (deliverMessage && this.#state === "open" && !this.#readableTerminal) {
          this.#readableController?.enqueue(incoming.data);
          return;
        }
        deliverMessage = false;
      }
    } catch (error) {
      this.#finishFailure(connectionError(error));
    } finally {
      this.#readInFlight = false;
      if (this.#state === "closing") this.#ensureCloseDrain();
    }
  }

  async #write(value: unknown): Promise<void> {
    if (this.#state !== "open") throw invalidStateError();
    const session = this.#session;
    if (session === null) throw invalidStateError();
    const message = snapshotMessage(value);
    this.#pendingWrites++;
    try {
      await session.send(message);
    } catch (error) {
      if (this.#terminalWriteError !== null) throw this.#terminalWriteError;
      const writeError = invalidStateError();
      this.#terminalWriteError = writeError;
      this.#hasUnwrittenData = true;
      if (this.#state === "open") {
        // A concurrent read is authoritative for the peer's close code. Raw
        // transports commonly reject the write just before that read settles.
        this.#state = "closing";
        this.#closeReadable();
        this.#ensureCloseDrain();
      }
      throw writeError;
    } finally {
      this.#pendingWrites--;
    }
  }

  #cancelReadable(reason: unknown): Promise<void> {
    // ReadableStream closes itself before it invokes the source cancel algorithm.
    this.#readableTerminal = true;
    const close = reason instanceof WebSocketError ? closeFromError(reason) : emptyClose();
    this.#beginClose(close, "readable-cancel");
    return Promise.resolve();
  }

  #closeWritable(): Promise<void> {
    return this.#beginClose(emptyClose(), "writable-close");
  }

  #abortWritable(reason: unknown): Promise<void> {
    const close = reason instanceof WebSocketError ? closeFromError(reason) : emptyClose();
    this.#beginClose(close, "writable-abort");
    return Promise.resolve();
  }

  #beginClose(close: NormalizedWebSocketClose, origin: CloseOrigin): Promise<void> {
    if (this.#state === "closed") return this.#closeCapability.promise;
    if (this.#state === "connecting") {
      const error = new WebSocketError("WebSocketStream was closed while connecting");
      this.#connectionController.abort(error);
      this.#failBeforeOpen(error);
      return this.#closeCapability.promise;
    }
    if (this.#state === "closing") return this.#closeCapability.promise;

    this.#state = "closing";
    this.#closeOrigin = origin;
    this.#closeReadable();
    if (origin === "public" || origin === "readable-cancel") {
      this.#errorWritable(invalidStateError());
    }
    const session = this.#session;
    if (session === null) {
      this.#finishFailure(new WebSocketError("WebSocketStream is not connected"));
      return this.#closeCapability.promise;
    }
    this.#ensureCloseDrain();
    this.#sendClose(session, close).catch((error) => this.#finishFailure(connectionError(error)));
    return this.#closeCapability.promise;
  }

  async #sendClose(session: WebSocketSession, close: NormalizedWebSocketClose): Promise<void> {
    await session.close(close.closeCode, close.reason);
  }

  #ensureCloseDrain(): void {
    if (this.#state !== "closing" || this.#readInFlight) return;
    ignoreRejection(this.#receive(false));
  }

  #finishFromPeer(close: SocketClose): void {
    if (this.#state === "closed") return;
    if (close.failed || !close.wasClean) {
      this.#finishFailure(
        createConnectionError("WebSocket connection closed abnormally", {
          closeCode: close.code,
          reason: close.reason,
        }),
      );
      return;
    }

    const hadUnwrittenData = this.#pendingWrites !== 0 || this.#hasUnwrittenData;
    const closeInfo = { closeCode: close.code, reason: close.reason };
    this.#state = "closed";
    if (hadUnwrittenData) {
      const writeError = this.#terminalWriteError ?? invalidStateError();
      this.#terminalWriteError = writeError;
      this.#errorWritable(writeError);
      const error = createConnectionError("WebSocket closed with unwritten data", closeInfo);
      this.#errorReadable(error);
      this.#closedCapability.reject(error);
      this.#closeCapability.reject(error);
    } else {
      this.#closeReadable();
      if (this.#closeOrigin !== "writable-close" && this.#closeOrigin !== "writable-abort") {
        this.#errorWritable(invalidStateError());
      }
      this.#closedCapability.resolve({ closeCode: close.code, reason: close.reason });
      this.#closeCapability.resolve();
    }
    this.#unregister();
  }

  #failBeforeOpen(reason: unknown): void {
    if (this.#state === "closed") return;
    this.#state = "closed";
    this.#removeAbortAlgorithm?.();
    this.#removeAbortAlgorithm = null;
    this.#openedCapability.reject(reason);
    this.#closedCapability.reject(reason);
    this.#closeCapability.reject(reason);
    this.#unregister();
  }

  #finishFailure(error: WebSocketError): void {
    if (this.#state === "closed") return;
    const wasConnecting = this.#state === "connecting";
    this.#state = "closed";
    this.#removeAbortAlgorithm?.();
    this.#removeAbortAlgorithm = null;
    this.#session?.abort();
    this.#terminalWriteError = error;
    if (wasConnecting) this.#openedCapability.reject(error);
    this.#errorReadable(error);
    this.#errorWritable(error);
    this.#closedCapability.reject(error);
    this.#closeCapability.reject(error);
    this.#unregister();
  }

  #closeReadable(): void {
    if (this.#readableTerminal) return;
    this.#readableTerminal = true;
    this.#readableController?.close();
  }

  #errorReadable(reason: unknown): void {
    if (this.#readableTerminal) return;
    this.#readableTerminal = true;
    this.#readableController?.error(reason);
  }

  #errorWritable(reason: unknown): void {
    if (this.#writableTerminal) return;
    this.#writableTerminal = true;
    this.#terminalWriteError = reason;
    this.#writableController?.error(reason);
  }

  #unregister(): void {
    if (!this.#registered) return;
    this.#registered = false;
    this.#context.unregisterWebSocketStream(this);
  }

  #isClosed(): boolean {
    return this.#state === "closed";
  }


  // Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
  // written inline rather than through a helper.
  static {
    Object.defineProperty(this.prototype, Symbol.toStringTag, {
      value: "WebSocketStream",
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

function readProtocols(input: Iterable<string> | null | undefined): string[] {
  if (input === undefined) return [];
  if (
    input === null ||
    typeof input === "string" ||
    (typeof input !== "object" && typeof input !== "function") ||
    !(Symbol.iterator in input)
  ) {
    throw new TypeError("WebSocketStream protocols must be a sequence");
  }
  return normalizeWebSocketProtocols(input);
}

function snapshotMessage(value: unknown): SocketMessage {
  if (value instanceof ArrayBuffer) {
    if (value.resizable) throw new TypeError("Resizable ArrayBuffer cannot be sent");
    return { kind: "binary", data: new Uint8Array(value).slice() };
  }
  if (ArrayBuffer.isView(value)) {
    if (!(value.buffer instanceof ArrayBuffer)) {
      throw new TypeError("Shared buffers cannot be sent");
    }
    if (value.buffer.resizable) throw new TypeError("Resizable ArrayBuffer cannot be sent");
    return {
      kind: "binary",
      data: new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice(),
    };
  }
  return { kind: "text", data: coerceToDOMString(value) };
}

function closeFromError(error: WebSocketError): NormalizedWebSocketClose {
  return { closeCode: error.closeCode, reason: error.reason };
}

function emptyClose(): NormalizedWebSocketClose {
  return { closeCode: null, reason: "" };
}

function invalidStateError(): DOMException {
  return new DOMException("WebSocket is not open", "InvalidStateError");
}

function connectionError(reason: unknown): WebSocketError {
  if (reason instanceof WebSocketError) return reason;
  const message = reason instanceof Error ? reason.message : "WebSocket connection failed";
  return new WebSocketError(message);
}

function createConnectionError(message: string, close: NormalizedWebSocketClose): WebSocketError {
  return new WebSocketError(message, undefined, {
    closeCode: close.closeCode,
    key: internalErrorKey,
    reason: close.reason,
  });
}

/**
 * @internal Construct a WebSocketStream owned by an explicit runtime.
 *
 * The capability travels through this module-private factory rather than a public
 * constructor argument, so script cannot supply it as a surplus argument.
 */
export function createInternalWebSocketStream(
  url: string,
  options: WebSocketStreamOptions | null | undefined,
  context: WebSocketStreamContext,
): WebSocketStream {
  return new WebSocketStream(url, options, webSocketStreamConstructorKey, context);
}
