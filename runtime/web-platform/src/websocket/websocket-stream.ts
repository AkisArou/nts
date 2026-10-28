import { AbortController, AbortSignal } from "../core/abort.ts";
import { DOMException } from "../core/errors.ts";
import { checkNetworkPort } from "../core/network-port.ts";
import { ignoreRejection } from "../core/promise.ts";
import {
  coerceToDOMString,
  coerceToUSVString,
  requireArguments,
  requireDictionary,
} from "../core/webidl.ts";
import { currentWebPlatformRuntime } from "../provider/environment.ts";
import type { Scheduler, URLRecord } from "../provider/primitives.ts";
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
  SocketIncoming,
  SocketMessage,
  WebSocketSession,
  WebSocketTransport,
} from "./transport.ts";
import { abortSignalSubscribe } from "../core/abort.ts";
import { webSocketCloseForRuntime } from "./websocket.ts";

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
  readonly scheduler: Scheduler;
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
  #connectionFailure: WebSocketError | null = null;
  #readInFlight = false;
  #readCompletion: PromiseWithResolvers<void> | null = null;
  #readDeliversMessage = false;
  #pendingIncoming: SocketIncoming | null = null;
  #pendingReadFailure: WebSocketError | null = null;
  #writeCompletion: PromiseWithResolvers<void> | null = null;
  #pendingCloseFailure: WebSocketError | null = null;
  #readableTerminal = false;
  #writableTerminal = false;
  #closeOrigin: CloseOrigin | null = null;
  #pendingWrites = 0;
  #hasUnwrittenData = false;
  #terminalWriteError: unknown = null;
  #registered = false;

  // Draft sections 4.1 and 4.2 use the WebSocket task source. These callbacks
  // are allocated once per stream; the receive and write slots each hold at
  // most one operation, without copying its payload or closing over a frame.
  readonly #onConnected = (session: WebSocketSession): void => {
    if (this.#state !== "connecting") {
      session.abort();
      return;
    }
    // Signal abort applies to the handshake, which is already established
    // even though its feedback task has not published opened yet.
    this.#removeAbortAlgorithm?.();
    this.#removeAbortAlgorithm = null;
    this.#session = session;
    this.#context.scheduler.enqueue(this.#runConnectionTask);
  };

  readonly #onConnectionFailed = (reason: unknown): void => {
    if (this.#state !== "connecting") return;
    this.#connectionFailure = connectionError(reason);
    this.#context.scheduler.enqueue(this.#runConnectionTask);
  };

  readonly #runConnectionTask = (): void => {
    const error = this.#connectionFailure;
    this.#connectionFailure = null;
    const session = this.#session;
    if (this.#state !== "connecting") {
      session?.abort();
      return;
    }
    if (error !== null) {
      this.#failBeforeOpen(error);
      return;
    }
    if (session === null) {
      this.#failBeforeOpen(new WebSocketError("WebSocketStream is not connected"));
      return;
    }
    this.#state = "open";
    try {
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
    } catch (reason) {
      const failure = connectionError(reason);
      this.#openedCapability.reject(failure);
      this.#finishFailure(failure);
    }
  };

  readonly #onIncoming = (incoming: SocketIncoming): void => {
    if (!this.#readInFlight) return;
    this.#pendingIncoming = incoming;
    this.#context.scheduler.enqueue(this.#runReadTask);
  };

  readonly #onReadFailed = (reason: unknown): void => {
    if (!this.#readInFlight) return;
    this.#pendingReadFailure = connectionError(reason);
    this.#context.scheduler.enqueue(this.#runReadTask);
  };

  readonly #runReadTask = (): void => {
    const incoming = this.#pendingIncoming;
    const error = this.#pendingReadFailure;
    this.#pendingIncoming = null;
    this.#pendingReadFailure = null;
    try {
      if (this.#state === "closed" || !this.#readInFlight) {
        this.#completeRead();
      } else if (error !== null) {
        this.#finishFailure(error);
      } else if (incoming?.kind === "close") {
        this.#finishFromPeer(incoming);
        this.#completeRead();
      } else if (incoming !== null) {
        if (this.#readDeliversMessage && this.#state === "open" && !this.#readableTerminal) {
          this.#readableController?.enqueue(incoming.data);
          this.#completeRead();
        } else {
          this.#readDeliversMessage = false;
          this.#requestRead();
        }
      }
    } catch (reason) {
      this.#finishFailure(connectionError(reason));
    }
  };

  readonly #onSent = (): void => {
    if (this.#writeCompletion !== null) this.#context.scheduler.enqueue(this.#runWriteTask);
  };

  readonly #onSendFailed = (_reason: unknown): void => {
    if (this.#writeCompletion === null) return;
    if (this.#terminalWriteError !== null) {
      this.#rejectWrite(this.#terminalWriteError);
      return;
    }
    const error = invalidStateError();
    this.#terminalWriteError = error;
    this.#hasUnwrittenData = true;
    if (this.#state === "open") {
      // A concurrent read is authoritative for the peer's close code. Raw
      // transports commonly reject the write just before that read settles.
      this.#state = "closing";
      this.#ensureCloseDrain();
    }
    this.#rejectWrite(error);
  };

  readonly #runWriteTask = (): void => {
    const completion = this.#writeCompletion;
    if (completion === null) return;
    this.#writeCompletion = null;
    this.#pendingWrites--;
    completion.resolve();
  };

  readonly #onCloseFailed = (reason: unknown): void => {
    if (this.#state === "closed" || this.#pendingCloseFailure !== null) return;
    this.#pendingCloseFailure = connectionError(reason);
    this.#context.scheduler.enqueue(this.#runCloseFailureTask);
  };

  readonly #runCloseFailureTask = (): void => {
    const error = this.#pendingCloseFailure;
    this.#pendingCloseFailure = null;
    if (error !== null) this.#finishFailure(error);
  };

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
      this.#removeAbortAlgorithm = signal[abortSignalSubscribe](() => {
        if (this.#state !== "connecting") return;
        this.#connectionController.abort(signal.reason);
        this.#failBeforeOpen(signal.reason);
      });
    }
    this.#connect(parsed, protocols);
  }

  close(options?: WebSocketCloseInfo | null): void {
    const close = normalizeWebSocketCloseInfo(options);
    this.#beginClose(close, "public");
  }

  [webSocketCloseForRuntime](): void {
    if (this.#state === "closed") return;
    const error = createConnectionError("Web-platform runtime is closed", {
      closeCode: 1006,
      reason: "",
    });
    this.#connectionController.abort(error);
    this.#session?.abort();
    this.#finishFailure(error);
  }

  #connect(url: URLRecord, protocols: readonly string[]): void {
    try {
      checkNetworkPort(url.port);
      this.#context.transport.connect(
        { url, protocols, origin: this.#context.origin ?? "null" },
        this.#connectionController.signal,
      ).then(this.#onConnected, this.#onConnectionFailed);
    } catch (reason) {
      this.#onConnectionFailed(reason);
    }
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

  #pull(): void | Promise<void> {
    if (this.#state !== "open" || this.#readInFlight) return;
    return this.#receive(true);
  }

  #receive(deliverMessage: boolean): void | Promise<void> {
    const session = this.#session;
    if (session === null || this.#state === "closed" || this.#readInFlight) return;
    // One pull capability replaces the previous nested async pull/receive
    // promises and stays pending until the scheduled feedback has been handled.
    const completion = Promise.withResolvers<void>();
    this.#readCompletion = completion;
    this.#readInFlight = true;
    this.#readDeliversMessage = deliverMessage;
    this.#requestRead();
    return completion.promise;
  }

  #requestRead(): void {
    const session = this.#session;
    if (session === null || this.#state === "closed") {
      this.#completeRead();
      return;
    }
    try {
      session.next().then(this.#onIncoming, this.#onReadFailed);
    } catch (reason) {
      this.#onReadFailed(reason);
    }
  }

  #completeRead(): void {
    const completion = this.#readCompletion;
    this.#readCompletion = null;
    this.#readInFlight = false;
    this.#pendingIncoming = null;
    this.#pendingReadFailure = null;
    completion?.resolve();
    if (this.#state === "closing") this.#ensureCloseDrain();
  }

  #write(value: unknown): Promise<void> {
    if (this.#state !== "open") throw invalidStateError();
    const session = this.#session;
    if (session === null) throw invalidStateError();
    const message = snapshotMessage(value);
    // The draft's write promise is settled by the task, with no extra async
    // wrapper or per-write continuation closure around the provider promise.
    const completion = Promise.withResolvers<void>();
    this.#writeCompletion = completion;
    this.#pendingWrites++;
    try {
      session.send(message).then(this.#onSent, this.#onSendFailed);
    } catch (reason) {
      this.#onSendFailed(reason);
    }
    return completion.promise;
  }

  #rejectWrite(reason: unknown): void {
    const completion = this.#writeCompletion;
    if (completion === null) return;
    this.#writeCompletion = null;
    this.#pendingWrites--;
    completion.reject(reason);
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
    // Draft sections 4.1 and 5: the readable finishes on protocol closure,
    // so a failed closing handshake can still error its pending reads.
    if (origin === "public" || origin === "readable-cancel") {
      this.#errorWritable(invalidStateError());
    }
    const session = this.#session;
    if (session === null) {
      this.#finishFailure(new WebSocketError("WebSocketStream is not connected"));
      return this.#closeCapability.promise;
    }
    this.#ensureCloseDrain();
    try {
      session.close(close.closeCode, close.reason).catch(this.#onCloseFailed);
    } catch (reason) {
      this.#onCloseFailed(reason);
    }
    return this.#closeCapability.promise;
  }

  #ensureCloseDrain(): void {
    if (this.#state !== "closing" || this.#readInFlight) return;
    this.#receive(false);
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
      this.#rejectWrite(writeError);
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
    this.#session?.abort();
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
    this.#rejectWrite(error);
    this.#completeRead();
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

}
// Web IDL surface shape; see core/interface-tag.ts for the rule and why it is
// written inline rather than through a helper.
// Web IDL member attributes; WebSocketStream prototype carries no non-standard names.
for (const key of Object.getOwnPropertyNames(WebSocketStream.prototype)) {
  if (key === "constructor") continue;
  const descriptor = Object.getOwnPropertyDescriptor(WebSocketStream.prototype, key);
  if (descriptor === undefined || descriptor.enumerable) continue;
  descriptor.enumerable = true;
  Object.defineProperty(WebSocketStream.prototype, key, descriptor);
}
Object.defineProperty(WebSocketStream.prototype, Symbol.toStringTag, {
  value: "WebSocketStream",
  writable: false,
  enumerable: false,
  configurable: true,
});
Object.defineProperty(WebSocketStream, "length", {
  value: 1,
  writable: false,
  enumerable: false,
  configurable: true,
});


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
  return { kind: "text", data: coerceToUSVString(value) };
}

function closeFromError(error: WebSocketError): NormalizedWebSocketClose {
  // Draft section 4.2: received codes such as 1001 are not script-settable.
  // If validation fails, close using reason discards both fields.
  try {
    return normalizeWebSocketCloseInfo(
      error.closeCode === null
        ? { reason: error.reason }
        : { closeCode: error.closeCode, reason: error.reason },
    );
  } catch {
    return emptyClose();
  }
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
