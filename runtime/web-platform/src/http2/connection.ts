import type { AbortSignal } from "../core/abort.ts";
import { encodeByteString, concatBytes } from "../core/encoding.ts";
import { LimitError, ProtocolError } from "../core/errors.ts";
import { ignoreRejection } from "../core/promise.ts";
import { BufferedReader, writeAll } from "../http1/io.ts";
import { ReadableStream } from "../streams/readable.ts";
import type {
  ReadableStreamDefaultController,
  ReadableStreamDefaultReader,
} from "../streams/readable.ts";
import type { ByteConnection } from "../provider/primitives.ts";
import { HpackDecoder, HpackEncoder } from "./hpack.ts";
import type { DecodedHpackHeaderField, HpackHeaderField, HpackLimits } from "./hpack.ts";
import {
  HTTP2_CANCEL,
  HTTP2_COMPRESSION_ERROR,
  HTTP2_DEFAULT_FRAME_SIZE,
  HTTP2_DEFAULT_WINDOW_SIZE,
  HTTP2_ENHANCE_YOUR_CALM,
  HTTP2_FLAG_ACK,
  HTTP2_FLAG_END_HEADERS,
  HTTP2_FLAG_END_STREAM,
  HTTP2_FLOW_CONTROL_ERROR,
  HTTP2_FRAME_CONTINUATION,
  HTTP2_FRAME_DATA,
  HTTP2_FRAME_GOAWAY,
  HTTP2_FRAME_HEADERS,
  HTTP2_FRAME_PING,
  HTTP2_FRAME_PRIORITY,
  HTTP2_FRAME_PUSH_PROMISE,
  HTTP2_FRAME_RST_STREAM,
  HTTP2_FRAME_SETTINGS,
  HTTP2_FRAME_WINDOW_UPDATE,
  HTTP2_INTERNAL_ERROR,
  HTTP2_MAX_FRAME_SIZE,
  HTTP2_MAX_WINDOW_SIZE,
  HTTP2_NO_ERROR,
  HTTP2_PROTOCOL_ERROR,
  HTTP2_REFUSED_STREAM,
  HTTP2_SETTING_ENABLE_CONNECT_PROTOCOL,
  HTTP2_SETTING_ENABLE_PUSH,
  HTTP2_SETTING_HEADER_TABLE_SIZE,
  HTTP2_SETTING_INITIAL_WINDOW_SIZE,
  HTTP2_SETTING_MAX_CONCURRENT_STREAMS,
  HTTP2_SETTING_MAX_FRAME_SIZE,
  HTTP2_SETTING_MAX_HEADER_LIST_SIZE,
  HTTP2_STREAM_CLOSED,
  Http2HeaderBlockAssembler,
  Http2WireError,
  encodeHttp2ErrorCode,
  encodeHttp2Frame,
  encodeHttp2GoAway,
  encodeHttp2Settings,
  encodeHttp2WindowUpdate,
  parseHttp2Data,
  parseHttp2GoAway,
  parseHttp2Priority,
  parseHttp2RstStream,
  parseHttp2Settings,
  parseHttp2WindowUpdate,
  readHttp2Frame,
} from "./frame.ts";
import type { Http2Frame, Http2HeaderBlock, Http2Setting } from "./frame.ts";
import {
  http2HeaderListSize,
  parseHttp2ResponseHeaders,
  parseHttp2Trailers,
  validateHttp2RequestHeaders,
} from "./headers.ts";
import type { Http2ResponseHeaders } from "./headers.ts";
import { abortSignalSubscribe } from "../core/abort-brand.ts";

const CLIENT_PREFACE = encodeByteString("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");

export interface Http2ConnectionOptions {
  readonly headerTableSize?: number;
  readonly initialStreamWindowSize?: number;
  readonly connectionWindowSize?: number;
  readonly maximumFrameSize?: number;
  readonly maximumHeaderListBytes?: number;
  readonly maximumHeaderStringBytes?: number;
  readonly maximumCompressedHeaderBlockBytes?: number;
  readonly maximumHeaderBlockFragments?: number;
  readonly maximumConcurrentStreams?: number;
  readonly maximumPendingRequests?: number;
  readonly enableConnectProtocol?: boolean;
}

export interface Http2ClientRequest {
  readonly headers: readonly HpackHeaderField[];
  readonly body: ReadableStream<Uint8Array> | null;
  readonly signal: AbortSignal;
  readonly onInformational?: (headers: Http2ResponseHeaders) => void;
}

export interface Http2ClientResponse {
  readonly status: number;
  readonly headers: readonly DecodedHpackHeaderField[];
  readonly body: ReadableStream<Uint8Array>;
  readonly trailers: Promise<readonly DecodedHpackHeaderField[]>;
}

interface NormalizedOptions {
  readonly headerTableSize: number;
  readonly initialStreamWindowSize: number;
  readonly connectionWindowSize: number;
  readonly maximumFrameSize: number;
  readonly maximumHeaderListBytes: number;
  readonly maximumHeaderStringBytes: number;
  readonly maximumCompressedHeaderBlockBytes: number;
  readonly maximumHeaderBlockFragments: number;
  readonly maximumConcurrentStreams: number;
  readonly maximumPendingRequests: number;
  readonly enableConnectProtocol: boolean;
}

interface QueuedWrite {
  readonly bytes: Uint8Array;
  readonly result: PromiseWithResolvers<void>;
}

interface SlotWaiter {
  readonly result: PromiseWithResolvers<void>;
  active: boolean;
  dispose: () => void;
}

interface IncomingData {
  readonly kind: "data";
  readonly bytes: Uint8Array;
  readonly flowBytes: number;
}

interface IncomingEnd {
  readonly kind: "end";
}

interface IncomingError {
  readonly kind: "error";
  readonly reason: unknown;
}

type IncomingItem = IncomingData | IncomingEnd | IncomingError;

function doNothing(): void {}

function requireInteger(value: number, minimum: number, maximum: number, name: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(name + " is outside the permitted range");
  }
}

function normalizeOptions(options: Http2ConnectionOptions): NormalizedOptions {
  const normalized: NormalizedOptions = {
    headerTableSize: options.headerTableSize ?? 4096,
    initialStreamWindowSize: options.initialStreamWindowSize ?? HTTP2_DEFAULT_WINDOW_SIZE,
    connectionWindowSize: options.connectionWindowSize ?? 1024 * 1024,
    maximumFrameSize: options.maximumFrameSize ?? HTTP2_DEFAULT_FRAME_SIZE,
    maximumHeaderListBytes: options.maximumHeaderListBytes ?? 64 * 1024,
    maximumHeaderStringBytes: options.maximumHeaderStringBytes ?? 64 * 1024,
    maximumCompressedHeaderBlockBytes: options.maximumCompressedHeaderBlockBytes ?? 64 * 1024,
    maximumHeaderBlockFragments: options.maximumHeaderBlockFragments ?? 1024,
    maximumConcurrentStreams: options.maximumConcurrentStreams ?? 100,
    maximumPendingRequests: options.maximumPendingRequests ?? 1024,
    enableConnectProtocol: options.enableConnectProtocol ?? true,
  };
  requireInteger(normalized.headerTableSize, 0, 0xffffffff, "HTTP/2 header table size");
  requireInteger(
    normalized.initialStreamWindowSize,
    0,
    HTTP2_MAX_WINDOW_SIZE,
    "HTTP/2 initial stream window",
  );
  requireInteger(
    normalized.connectionWindowSize,
    HTTP2_DEFAULT_WINDOW_SIZE,
    HTTP2_MAX_WINDOW_SIZE,
    "HTTP/2 connection window",
  );
  requireInteger(
    normalized.maximumFrameSize,
    HTTP2_DEFAULT_FRAME_SIZE,
    HTTP2_MAX_FRAME_SIZE,
    "HTTP/2 maximum frame size",
  );
  requireInteger(
    normalized.maximumHeaderListBytes,
    0,
    0xffffffff,
    "HTTP/2 maximum header list size",
  );
  requireInteger(
    normalized.maximumHeaderStringBytes,
    0,
    HTTP2_MAX_WINDOW_SIZE,
    "HTTP/2 maximum header string size",
  );
  requireInteger(
    normalized.maximumCompressedHeaderBlockBytes,
    0,
    HTTP2_MAX_WINDOW_SIZE,
    "HTTP/2 maximum compressed header block size",
  );
  requireInteger(
    normalized.maximumHeaderBlockFragments,
    1,
    HTTP2_MAX_WINDOW_SIZE,
    "HTTP/2 header block fragment limit",
  );
  requireInteger(
    normalized.maximumConcurrentStreams,
    0,
    0xffffffff,
    "HTTP/2 maximum concurrent streams",
  );
  requireInteger(
    normalized.maximumPendingRequests,
    0,
    HTTP2_MAX_WINDOW_SIZE,
    "HTTP/2 pending request limit",
  );
  if (typeof normalized.enableConnectProtocol !== "boolean") {
    throw new TypeError("HTTP/2 extended CONNECT option must be boolean");
  }
  return normalized;
}

function errorFromPeer(errorCode: number, streamId: number, message: string): Http2WireError {
  return new Http2WireError(message, errorCode, streamId);
}

function requestMethod(headers: readonly HpackHeaderField[]): string {
  for (const field of headers) if (field.name === ":method") return field.value;
  return "";
}

class Http2ClientStream {
  readonly id: number;
  sendWindow: number;
  receiveWindow: number;
  localEnded: boolean;
  remoteEnded = false;
  responseDelivered = false;
  responseStatus = 0;
  expectedContentLength: number | null = null;
  receivedBodyBytes = 0;
  bodyForbidden: boolean;

  private readonly connection: Http2ClientConnection;
  private readonly responseResult = Promise.withResolvers<Http2ClientResponse>();
  private readonly trailersResult = Promise.withResolvers<readonly DecodedHpackHeaderField[]>();
  private readonly onInformational: ((headers: Http2ResponseHeaders) => void) | undefined;
  private readonly incoming: IncomingItem[] = [];
  private incomingOffset = 0;
  private incomingWaiter: PromiseWithResolvers<IncomingItem> | null = null;
  private appTerminal = false;
  private failed = false;
  private trailersSettled = false;
  private uploadReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private disposeAbort: () => void = doNothing;
  private readonly expectedSendLength: number | null;
  private sentBodyBytes = 0;

  readonly body: ReadableStream<Uint8Array>;

  constructor(
    connection: Http2ClientConnection,
    id: number,
    initialSendWindow: number,
    initialReceiveWindow: number,
    method: string,
    hasBody: boolean,
    expectedSendLength: number | null,
    onInformational: ((headers: Http2ResponseHeaders) => void) | undefined,
  ) {
    this.connection = connection;
    this.id = id;
    this.sendWindow = initialSendWindow;
    this.receiveWindow = initialReceiveWindow;
    this.localEnded = !hasBody;
    this.expectedSendLength = expectedSendLength;
    this.bodyForbidden = method === "HEAD";
    this.onInformational = onInformational;
    ignoreRejection(this.responseResult.promise);
    ignoreRejection(this.trailersResult.promise);
    this.body = new ReadableStream<Uint8Array>(
      {
        pull: (controller) => this.pullBody(controller),
        cancel: (reason) => this.cancelBody(reason),
      },
      { highWaterMark: 0 },
    );
  }

  get response(): Promise<Http2ClientResponse> {
    return this.responseResult.promise;
  }

  attachSignal(signal: AbortSignal): void {
    this.disposeAbort = signal[abortSignalSubscribe](() => this.connection.cancelStream(this, signal.reason));
  }

  setUploadReader(reader: ReadableStreamDefaultReader<Uint8Array> | null): void {
    this.uploadReader = reader;
  }

  acceptSendBytes(length: number): void {
    this.sentBodyBytes += length;
    if (
      !Number.isSafeInteger(this.sentBodyBytes) ||
      (this.expectedSendLength !== null && this.sentBodyBytes > this.expectedSendLength)
    ) {
      throw new ProtocolError("HTTP/2 request body exceeds Content-Length");
    }
  }

  verifySendComplete(): void {
    if (this.expectedSendLength !== null && this.sentBodyBytes !== this.expectedSendLength) {
      throw new ProtocolError("HTTP/2 request body is shorter than Content-Length");
    }
  }

  handleHeaders(parsed: Http2ResponseHeaders, endStream: boolean): void {
    if (this.remoteEnded) {
      this.connection.resetStream(this, HTTP2_STREAM_CLOSED, "HEADERS followed remote END_STREAM");
      return;
    }
    if (!this.responseDelivered) {
      if (parsed.status < 200) {
        if (endStream) {
          this.connection.resetStream(
            this,
            HTTP2_PROTOCOL_ERROR,
            "Informational response ended the HTTP/2 stream",
          );
          return;
        }
        try {
          this.onInformational?.(parsed);
        } catch {
          this.connection.resetStream(
            this,
            HTTP2_INTERNAL_ERROR,
            "HTTP/2 informational callback failed",
          );
        }
        return;
      }
      this.responseDelivered = true;
      this.responseStatus = parsed.status;
      this.expectedContentLength = parsed.contentLength;
      this.bodyForbidden =
        this.bodyForbidden ||
        parsed.status === 204 ||
        parsed.status === 205 ||
        parsed.status === 304;
      this.responseResult.resolve({
        status: parsed.status,
        headers: parsed.headers,
        body: this.body,
        trailers: this.trailersResult.promise,
      });
      if (endStream) this.receiveEnd();
      return;
    }
    if (!endStream) {
      this.connection.resetStream(
        this,
        HTTP2_PROTOCOL_ERROR,
        "HTTP/2 trailer block omitted END_STREAM",
      );
      return;
    }
    this.settleTrailers(parsed.headers);
    this.receiveEnd();
  }

  handleTrailers(fields: readonly DecodedHpackHeaderField[], endStream: boolean): void {
    if (!this.responseDelivered || !endStream) {
      this.connection.resetStream(this, HTTP2_PROTOCOL_ERROR, "Invalid HTTP/2 trailer block");
      return;
    }
    this.settleTrailers(fields);
    this.receiveEnd();
  }

  receiveData(data: Uint8Array, flowBytes: number, endStream: boolean): void {
    if (!this.responseDelivered || this.remoteEnded) {
      this.connection.resetStream(
        this,
        HTTP2_STREAM_CLOSED,
        "DATA arrived outside a response body",
      );
      this.connection.returnConnectionCredit(flowBytes);
      return;
    }
    this.receivedBodyBytes += data.length;
    if (
      !Number.isSafeInteger(this.receivedBodyBytes) ||
      (this.bodyForbidden && data.length !== 0)
    ) {
      this.connection.resetStream(
        this,
        HTTP2_PROTOCOL_ERROR,
        "HTTP/2 response body is not permitted",
      );
      this.connection.returnConnectionCredit(flowBytes);
      return;
    }
    if (data.length === 0) this.connection.returnReceiveCredit(this, flowBytes);
    else this.pushIncoming({ kind: "data", bytes: data, flowBytes });
    if (endStream) this.receiveEnd();
  }

  receiveEnd(): void {
    if (this.remoteEnded) return;
    this.remoteEnded = true;
    if (
      !this.bodyForbidden &&
      this.expectedContentLength !== null &&
      this.expectedContentLength !== this.receivedBodyBytes
    ) {
      this.fail(errorFromPeer(HTTP2_PROTOCOL_ERROR, this.id, "HTTP/2 Content-Length mismatch"));
      this.connection.streamStateChanged(this);
      return;
    }
    this.settleTrailers([]);
    this.pushIncoming({ kind: "end" });
    this.connection.streamStateChanged(this);
  }

  peerReset(errorCode: number): void {
    this.localEnded = true;
    this.remoteEnded = true;
    this.fail(errorFromPeer(errorCode, this.id, "Peer reset the HTTP/2 stream"));
    this.connection.streamStateChanged(this);
  }

  fail(reason: unknown): void {
    if (this.failed) return;
    this.failed = true;
    this.localEnded = true;
    this.remoteEnded = true;
    this.uploadReader?.cancel(reason).catch(() => {});
    this.uploadReader = null;
    if (!this.responseDelivered) this.responseResult.reject(reason);
    if (!this.trailersSettled) {
      this.trailersSettled = true;
      this.trailersResult.reject(reason);
    }
    this.discardIncoming();
    this.pushIncoming({ kind: "error", reason });
    this.finishApplication();
  }

  markLocalEnd(): void {
    if (this.localEnded) return;
    this.localEnded = true;
    this.connection.streamStateChanged(this);
  }

  finishApplication(): void {
    if (this.appTerminal) return;
    this.appTerminal = true;
    this.disposeAbort();
    this.disposeAbort = doNothing;
    this.uploadReader = null;
  }

  private settleTrailers(fields: readonly DecodedHpackHeaderField[]): void {
    if (this.trailersSettled) return;
    this.trailersSettled = true;
    this.trailersResult.resolve(fields);
  }

  private pushIncoming(item: IncomingItem): void {
    const waiter = this.incomingWaiter;
    if (waiter !== null) {
      this.incomingWaiter = null;
      waiter.resolve(item);
      return;
    }
    this.incoming.push(item);
  }

  private async nextIncoming(): Promise<IncomingItem> {
    const item = this.incoming[this.incomingOffset];
    if (item !== undefined) {
      this.incomingOffset++;
      if (this.incomingOffset > 32 && this.incomingOffset * 2 >= this.incoming.length) {
        this.incoming.splice(0, this.incomingOffset);
        this.incomingOffset = 0;
      }
      return item;
    }
    const waiter = Promise.withResolvers<IncomingItem>();
    this.incomingWaiter = waiter;
    return waiter.promise;
  }

  private async pullBody(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
    const item = await this.nextIncoming();
    if (item.kind === "data") {
      controller.enqueue(item.bytes);
      this.connection.returnReceiveCredit(this, item.flowBytes);
      return;
    }
    this.finishApplication();
    if (item.kind === "end") {
      controller.close();
      return;
    }
    throw item.reason;
  }

  private cancelBody(reason: unknown): void {
    if (this.appTerminal) return;
    this.discardIncoming();
    this.finishApplication();
    this.connection.cancelStream(this, reason);
  }

  private discardIncoming(): void {
    let returned = 0;
    for (let index = this.incomingOffset; index < this.incoming.length; index++) {
      const item = this.incoming[index];
      if (item?.kind === "data") returned += item.flowBytes;
    }
    this.incoming.length = 0;
    this.incomingOffset = 0;
    if (returned !== 0) this.connection.returnConnectionCredit(returned);
  }
}

export class Http2ClientConnection {
  private readonly connection: ByteConnection;
  private readonly reader: BufferedReader;
  private readonly options: NormalizedOptions;
  private readonly decoder: HpackDecoder;
  private readonly encoder = new HpackEncoder();
  private readonly blocks: Http2HeaderBlockAssembler;
  private readonly streams = new Map<number, Http2ClientStream>();
  private readonly writes: QueuedWrite[] = [];
  private writeOffset = 0;
  private writing = false;
  private readonly slotWaiters: SlotWaiter[] = [];
  private slotOffset = 0;
  private reservedSlots = 0;
  private readonly readyResult = Promise.withResolvers<void>();
  private readonly closedResult = Promise.withResolvers<void>();
  private flowSignal = Promise.withResolvers<void>();
  private nextStreamId = 1;
  private highestOpenedStreamId = 0;
  private remoteMaximumConcurrentStreams = 0xffffffff;
  private remoteInitialWindowSize = HTTP2_DEFAULT_WINDOW_SIZE;
  private remoteMaximumFrameSize = HTTP2_DEFAULT_FRAME_SIZE;
  private remoteMaximumHeaderListSize = 0xffffffff;
  private remoteExtendedConnect = false;
  private connectionSendWindow = HTTP2_DEFAULT_WINDOW_SIZE;
  private connectionReceiveWindow: number;
  private receivedSettings = false;
  private settingsAcknowledged = false;
  private started = false;
  private draining = false;
  private terminating = false;
  private terminated = false;
  private remoteLastStreamId = HTTP2_MAX_WINDOW_SIZE;
  private localGoAwaySent = false;
  private remoteGoAwayReceived = false;

  constructor(connection: ByteConnection, options: Http2ConnectionOptions = {}) {
    this.connection = connection;
    this.reader = new BufferedReader(connection);
    this.options = normalizeOptions(options);
    const hpackLimits: HpackLimits = {
      maxHeaderListBytes: this.options.maximumHeaderListBytes,
      maxStringBytes: this.options.maximumHeaderStringBytes,
    };
    this.decoder = new HpackDecoder(this.options.headerTableSize, hpackLimits);
    this.blocks = new Http2HeaderBlockAssembler(
      this.options.maximumCompressedHeaderBlockBytes,
      this.options.maximumHeaderBlockFragments,
    );
    this.connectionReceiveWindow = this.options.connectionWindowSize;
    ignoreRejection(this.readyResult.promise);
    ignoreRejection(this.closedResult.promise);
  }

  get ready(): Promise<void> {
    return this.readyResult.promise;
  }

  get closed(): Promise<void> {
    return this.closedResult.promise;
  }

  get activeStreamCount(): number {
    return this.streams.size;
  }

  get isDraining(): boolean {
    return this.draining;
  }

  get peerSettingsAcknowledged(): boolean {
    return this.settingsAcknowledged;
  }

  async start(): Promise<void> {
    if (this.started) throw new TypeError("HTTP/2 connection was already started");
    if (this.connection.closed) throw new TypeError("HTTP/2 byte connection is closed");
    this.started = true;
    const settings: Http2Setting[] = [
      { identifier: HTTP2_SETTING_HEADER_TABLE_SIZE, value: this.options.headerTableSize },
      { identifier: HTTP2_SETTING_ENABLE_PUSH, value: 0 },
      {
        identifier: HTTP2_SETTING_MAX_CONCURRENT_STREAMS,
        value: this.options.maximumConcurrentStreams,
      },
      {
        identifier: HTTP2_SETTING_INITIAL_WINDOW_SIZE,
        value: this.options.initialStreamWindowSize,
      },
      { identifier: HTTP2_SETTING_MAX_FRAME_SIZE, value: this.options.maximumFrameSize },
      {
        identifier: HTTP2_SETTING_MAX_HEADER_LIST_SIZE,
        value: this.options.maximumHeaderListBytes,
      },
    ];
    if (this.options.enableConnectProtocol) {
      settings.push({ identifier: HTTP2_SETTING_ENABLE_CONNECT_PROTOCOL, value: 1 });
    }
    const frames = [
      encodeHttp2Frame(
        {
          type: HTTP2_FRAME_SETTINGS,
          flags: 0,
          streamId: 0,
          payload: encodeHttp2Settings(settings),
        },
        HTTP2_DEFAULT_FRAME_SIZE,
      ),
    ];
    if (this.options.connectionWindowSize > HTTP2_DEFAULT_WINDOW_SIZE) {
      frames.push(
        encodeHttp2Frame({
          type: HTTP2_FRAME_WINDOW_UPDATE,
          flags: 0,
          streamId: 0,
          payload: encodeHttp2WindowUpdate(
            this.options.connectionWindowSize - HTTP2_DEFAULT_WINDOW_SIZE,
          ),
        }),
      );
    }
    await this.enqueueBytes(concatBytes([CLIENT_PREFACE, ...frames]));
    ignoreRejection(this.readLoop());
  }

  async request(request: Http2ClientRequest): Promise<Http2ClientResponse> {
    if (!this.started) throw new TypeError("HTTP/2 connection has not been started");
    request.signal.throwIfAborted();
    await this.waitUntilReady(request.signal);
    await this.reserveStreamSlot(request.signal);
    let slotReserved = true;
    try {
      if (this.draining || this.terminating || this.terminated) {
        throw new Http2WireError("HTTP/2 connection is draining", HTTP2_REFUSED_STREAM);
      }
      if (this.nextStreamId > HTTP2_MAX_WINDOW_SIZE) {
        this.draining = true;
        throw new Http2WireError("HTTP/2 stream identifiers are exhausted", HTTP2_REFUSED_STREAM);
      }
      const streamId = this.nextStreamId;
      this.nextStreamId += 2;
      const expectedSendLength = validateHttp2RequestHeaders(
        request.headers,
        streamId,
        this.options.enableConnectProtocol && this.remoteExtendedConnect,
      );
      if (request.body === null && expectedSendLength !== null && expectedSendLength !== 0) {
        throw new TypeError("HTTP/2 Content-Length requires a request body");
      }
      if (http2HeaderListSize(request.headers) > this.remoteMaximumHeaderListSize) {
        throw new LimitError("HTTP/2 request header list exceeds the peer setting");
      }
      const block = this.encoder.encode(request.headers);
      const stream = new Http2ClientStream(
        this,
        streamId,
        this.remoteInitialWindowSize,
        this.options.initialStreamWindowSize,
        requestMethod(request.headers),
        request.body !== null,
        expectedSendLength,
        request.onInformational,
      );
      this.reservedSlots--;
      slotReserved = false;
      this.streams.set(streamId, stream);
      this.highestOpenedStreamId = streamId;
      stream.attachSignal(request.signal);
      try {
        await this.sendHeaderBlock(streamId, block, request.body === null);
      } catch (error) {
        stream.fail(error);
        this.streamStateChanged(stream);
        throw error;
      }
      if (request.body !== null) ignoreRejection(this.sendRequestBody(stream, request.body));
      else this.streamStateChanged(stream);
      return stream.response;
    } finally {
      if (slotReserved) {
        this.reservedSlots--;
        this.wakeSlotWaiters();
      }
    }
  }

  async drain(): Promise<void> {
    if (this.terminated) return this.closed;
    if (!this.started) {
      this.terminate(
        new TypeError("HTTP/2 connection drained before start"),
        HTTP2_NO_ERROR,
        false,
      );
      return this.closed;
    }
    if (!this.draining) {
      this.draining = true;
      this.failSlotWaiters(
        new Http2WireError("HTTP/2 connection is draining", HTTP2_REFUSED_STREAM),
      );
      await this.sendFrame({
        type: HTTP2_FRAME_GOAWAY,
        flags: 0,
        streamId: 0,
        payload: encodeHttp2GoAway(0, HTTP2_NO_ERROR),
      });
      this.localGoAwaySent = true;
    }
    this.finishDrainIfIdle();
    return this.closed;
  }

  close(reason: unknown = new TypeError("HTTP/2 connection closed")): void {
    if (this.terminated || this.terminating) return;
    this.draining = true;
    this.terminate(reason, HTTP2_NO_ERROR, this.started);
  }

  cancelStream(stream: Http2ClientStream, reason: unknown): void {
    if (!this.streams.has(stream.id)) {
      stream.fail(reason);
      stream.finishApplication();
      return;
    }
    ignoreRejection(
      this.sendFrame({
        type: HTTP2_FRAME_RST_STREAM,
        flags: 0,
        streamId: stream.id,
        payload: encodeHttp2ErrorCode(HTTP2_CANCEL),
      }),
    );
    stream.fail(reason);
    stream.finishApplication();
    this.streamStateChanged(stream);
  }

  resetStream(stream: Http2ClientStream, errorCode: number, message: string): void {
    if (this.streams.has(stream.id)) {
      ignoreRejection(
        this.sendFrame({
          type: HTTP2_FRAME_RST_STREAM,
          flags: 0,
          streamId: stream.id,
          payload: encodeHttp2ErrorCode(errorCode),
        }),
      );
    }
    stream.fail(errorFromPeer(errorCode, stream.id, message));
    stream.finishApplication();
    this.streamStateChanged(stream);
  }

  streamStateChanged(stream: Http2ClientStream): void {
    if (!stream.localEnded || !stream.remoteEnded) return;
    if (this.streams.delete(stream.id)) {
      this.wakeSlotWaiters();
      this.finishDrainIfIdle();
    }
  }

  returnReceiveCredit(stream: Http2ClientStream, amount: number): void {
    this.returnConnectionCredit(amount);
    if (stream.remoteEnded || !this.streams.has(stream.id) || amount === 0) return;
    if (stream.receiveWindow > HTTP2_MAX_WINDOW_SIZE - amount) {
      this.terminate(
        new Http2WireError("HTTP/2 stream receive window overflow", HTTP2_FLOW_CONTROL_ERROR),
        HTTP2_FLOW_CONTROL_ERROR,
        true,
      );
      return;
    }
    stream.receiveWindow += amount;
    ignoreRejection(
      this.sendFrame({
        type: HTTP2_FRAME_WINDOW_UPDATE,
        flags: 0,
        streamId: stream.id,
        payload: encodeHttp2WindowUpdate(amount),
      }),
    );
  }

  returnConnectionCredit(amount: number): void {
    if (amount === 0 || this.terminating || this.terminated) return;
    if (this.connectionReceiveWindow > HTTP2_MAX_WINDOW_SIZE - amount) {
      this.terminate(
        new Http2WireError("HTTP/2 connection receive window overflow", HTTP2_FLOW_CONTROL_ERROR),
        HTTP2_FLOW_CONTROL_ERROR,
        true,
      );
      return;
    }
    this.connectionReceiveWindow += amount;
    ignoreRejection(
      this.sendFrame({
        type: HTTP2_FRAME_WINDOW_UPDATE,
        flags: 0,
        streamId: 0,
        payload: encodeHttp2WindowUpdate(amount),
      }),
    );
  }

  private async readLoop(): Promise<void> {
    try {
      while (!this.terminating && !this.terminated) {
        const frame = await readHttp2Frame(this.reader, this.options.maximumFrameSize);
        if (!this.receivedSettings) {
          if (frame.type !== HTTP2_FRAME_SETTINGS || (frame.flags & HTTP2_FLAG_ACK) !== 0) {
            throw new Http2WireError(
              "The first peer HTTP/2 frame is not initial SETTINGS",
              HTTP2_PROTOCOL_ERROR,
            );
          }
        }
        try {
          await this.handleFrame(frame);
        } catch (error) {
          if (error instanceof Http2WireError && error.streamId !== null) {
            const stream = this.streams.get(error.streamId);
            if (stream !== undefined) this.resetStream(stream, error.errorCode, error.message);
            else this.sendClosedStreamReset(error.streamId);
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      if (this.terminating || this.terminated) return;
      const code =
        error instanceof Http2WireError
          ? error.errorCode
          : error instanceof LimitError
            ? HTTP2_ENHANCE_YOUR_CALM
            : HTTP2_INTERNAL_ERROR;
      this.terminate(error, code, true);
    }
  }

  private async handleFrame(frame: Http2Frame): Promise<void> {
    if (frame.type === HTTP2_FRAME_PUSH_PROMISE) {
      throw new Http2WireError(
        "Peer sent PUSH_PROMISE after client disabled server push",
        HTTP2_PROTOCOL_ERROR,
      );
    }
    const headerBlock = this.blocks.accept(frame);
    if (
      frame.type === HTTP2_FRAME_HEADERS ||
      frame.type === HTTP2_FRAME_CONTINUATION ||
      frame.type === HTTP2_FRAME_PUSH_PROMISE
    ) {
      if (headerBlock !== null) this.handleHeaderBlock(headerBlock);
      return;
    }

    switch (frame.type) {
      case HTTP2_FRAME_DATA:
        this.handleData(frame);
        return;
      case HTTP2_FRAME_PRIORITY:
        parseHttp2Priority(frame);
        return;
      case HTTP2_FRAME_RST_STREAM:
        this.handleReset(frame);
        return;
      case HTTP2_FRAME_SETTINGS:
        await this.handleSettings(frame);
        return;
      case HTTP2_FRAME_PING:
        if ((frame.flags & HTTP2_FLAG_ACK) === 0) {
          await this.sendFrame({
            type: HTTP2_FRAME_PING,
            flags: HTTP2_FLAG_ACK,
            streamId: 0,
            payload: frame.payload,
          });
        }
        return;
      case HTTP2_FRAME_GOAWAY:
        this.handleGoAway(frame);
        return;
      case HTTP2_FRAME_WINDOW_UPDATE:
        this.handleWindowUpdate(frame);
        return;
    }
  }

  private handleHeaderBlock(headerBlock: Http2HeaderBlock): void {
    if (headerBlock.kind === "push-promise") {
      throw new Http2WireError("HTTP/2 server push is disabled", HTTP2_PROTOCOL_ERROR);
    }
    let decoded: readonly DecodedHpackHeaderField[];
    try {
      decoded = this.decoder.decode(headerBlock.block);
    } catch (error) {
      if (error instanceof LimitError) {
        throw new Http2WireError(
          "HTTP/2 decoded header list exceeds configured limits",
          HTTP2_ENHANCE_YOUR_CALM,
        );
      }
      throw new Http2WireError(
        "HTTP/2 header compression failed: " +
          (error instanceof Error ? error.message : "unknown compression error"),
        HTTP2_COMPRESSION_ERROR,
      );
    }
    const stream = this.findStream(headerBlock.streamId, "HEADERS");
    if (stream === null) {
      this.sendClosedStreamReset(headerBlock.streamId);
      return;
    }
    if (
      headerBlock.priority !== null &&
      headerBlock.priority.streamDependency === headerBlock.streamId
    ) {
      this.resetStream(stream, HTTP2_PROTOCOL_ERROR, "HTTP/2 stream depends on itself");
      return;
    }
    if (stream.remoteEnded) {
      this.resetStream(stream, HTTP2_STREAM_CLOSED, "HEADERS followed remote END_STREAM");
      return;
    }
    if (stream.responseDelivered) {
      const trailers = parseHttp2Trailers(decoded, stream.id);
      stream.handleTrailers(trailers, headerBlock.endStream);
      return;
    }
    const headers = parseHttp2ResponseHeaders(decoded, stream.id);
    stream.handleHeaders(headers, headerBlock.endStream);
  }

  private handleData(frame: Http2Frame): void {
    const stream = this.findStream(frame.streamId, "DATA");
    const parsed = parseHttp2Data(frame);
    const flowBytes = frame.payload.length;
    this.connectionReceiveWindow -= flowBytes;
    if (this.connectionReceiveWindow < 0) {
      throw new Http2WireError(
        "Peer exceeded the HTTP/2 connection flow-control window",
        HTTP2_FLOW_CONTROL_ERROR,
      );
    }
    if (stream === null) {
      this.returnConnectionCredit(flowBytes);
      this.sendClosedStreamReset(frame.streamId);
      return;
    }
    stream.receiveWindow -= flowBytes;
    if (stream.receiveWindow < 0) {
      this.returnConnectionCredit(flowBytes);
      this.resetStream(
        stream,
        HTTP2_FLOW_CONTROL_ERROR,
        "Peer exceeded the HTTP/2 stream flow-control window",
      );
      return;
    }
    stream.receiveData(parsed.data, flowBytes, (frame.flags & HTTP2_FLAG_END_STREAM) !== 0);
  }

  private handleReset(frame: Http2Frame): void {
    const stream = this.findStream(frame.streamId, "RST_STREAM");
    if (stream !== null) stream.peerReset(parseHttp2RstStream(frame));
  }

  private async handleSettings(frame: Http2Frame): Promise<void> {
    if ((frame.flags & HTTP2_FLAG_ACK) !== 0) {
      this.settingsAcknowledged = true;
      return;
    }
    const settings = parseHttp2Settings(frame);
    for (const setting of settings) this.applyRemoteSetting(setting);
    this.receivedSettings = true;
    await this.sendFrame({
      type: HTTP2_FRAME_SETTINGS,
      flags: HTTP2_FLAG_ACK,
      streamId: 0,
      payload: new Uint8Array(0),
    });
    this.readyResult.resolve();
    this.wakeSlotWaiters();
  }

  private applyRemoteSetting(setting: Http2Setting): void {
    switch (setting.identifier) {
      case HTTP2_SETTING_HEADER_TABLE_SIZE:
        this.encoder.setMaximumTableSize(setting.value);
        return;
      case HTTP2_SETTING_ENABLE_PUSH:
        throw new Http2WireError(
          "Server sent the client-only SETTINGS_ENABLE_PUSH",
          HTTP2_PROTOCOL_ERROR,
        );
      case HTTP2_SETTING_MAX_CONCURRENT_STREAMS:
        this.remoteMaximumConcurrentStreams = setting.value;
        this.wakeSlotWaiters();
        return;
      case HTTP2_SETTING_INITIAL_WINDOW_SIZE: {
        const difference = setting.value - this.remoteInitialWindowSize;
        for (const stream of this.streams.values()) {
          if (difference > 0 && stream.sendWindow > HTTP2_MAX_WINDOW_SIZE - difference) {
            throw new Http2WireError(
              "HTTP/2 stream send window overflow after SETTINGS",
              HTTP2_FLOW_CONTROL_ERROR,
            );
          }
          stream.sendWindow += difference;
        }
        this.remoteInitialWindowSize = setting.value;
        this.notifyFlowChange();
        return;
      }
      case HTTP2_SETTING_MAX_FRAME_SIZE:
        this.remoteMaximumFrameSize = setting.value;
        return;
      case HTTP2_SETTING_MAX_HEADER_LIST_SIZE:
        this.remoteMaximumHeaderListSize = setting.value;
        return;
      case HTTP2_SETTING_ENABLE_CONNECT_PROTOCOL:
        this.remoteExtendedConnect = setting.value === 1;
        return;
    }
  }

  private handleGoAway(frame: Http2Frame): void {
    const goAway = parseHttp2GoAway(frame);
    if (goAway.lastStreamId > this.remoteLastStreamId) {
      throw new Http2WireError(
        "Peer increased the last stream identifier in a later GOAWAY",
        HTTP2_PROTOCOL_ERROR,
      );
    }
    this.remoteLastStreamId = goAway.lastStreamId;
    this.remoteGoAwayReceived = true;
    this.draining = true;
    this.failSlotWaiters(new Http2WireError("Peer is draining HTTP/2", HTTP2_REFUSED_STREAM));
    for (const stream of this.streams.values()) {
      if (stream.id > goAway.lastStreamId) {
        stream.fail(
          errorFromPeer(
            HTTP2_REFUSED_STREAM,
            stream.id,
            "Peer GOAWAY did not process this HTTP/2 stream",
          ),
        );
        this.streamStateChanged(stream);
      }
    }
    this.finishDrainIfIdle();
  }

  private handleWindowUpdate(frame: Http2Frame): void {
    const increment = parseHttp2WindowUpdate(frame);
    if (frame.streamId === 0) {
      if (this.connectionSendWindow > HTTP2_MAX_WINDOW_SIZE - increment) {
        throw new Http2WireError(
          "HTTP/2 connection send window overflow",
          HTTP2_FLOW_CONTROL_ERROR,
        );
      }
      this.connectionSendWindow += increment;
      this.notifyFlowChange();
      return;
    }
    const stream = this.findStream(frame.streamId, "WINDOW_UPDATE");
    if (stream === null) return;
    if (stream.sendWindow > HTTP2_MAX_WINDOW_SIZE - increment) {
      this.resetStream(stream, HTTP2_FLOW_CONTROL_ERROR, "HTTP/2 stream send window overflow");
      return;
    }
    stream.sendWindow += increment;
    this.notifyFlowChange();
  }

  private async sendRequestBody(
    stream: Http2ClientStream,
    body: ReadableStream<Uint8Array>,
  ): Promise<void> {
    const reader = body.getReader();
    stream.setUploadReader(reader);
    try {
      while (!stream.localEnded) {
        const result = await reader.read();
        if (result.done) break;
        stream.acceptSendBytes(result.value.length);
        let offset = 0;
        while (offset < result.value.length && !stream.localEnded) {
          let length = this.reserveSendCapacity(stream, result.value.length - offset);
          while (length === 0) {
            await this.waitForFlowChange(stream);
            length = this.reserveSendCapacity(stream, result.value.length - offset);
          }
          const payload = result.value.subarray(offset, offset + length);
          await this.sendFrame({
            type: HTTP2_FRAME_DATA,
            flags: 0,
            streamId: stream.id,
            payload,
          });
          offset += length;
        }
      }
      if (!stream.localEnded) {
        stream.verifySendComplete();
        await this.sendFrame({
          type: HTTP2_FRAME_DATA,
          flags: HTTP2_FLAG_END_STREAM,
          streamId: stream.id,
          payload: new Uint8Array(0),
        });
        stream.markLocalEnd();
      }
    } catch (error) {
      if (!stream.localEnded)
        this.resetStream(stream, HTTP2_INTERNAL_ERROR, "HTTP/2 upload failed");
    } finally {
      stream.setUploadReader(null);
      reader.releaseLock();
    }
  }

  private reserveSendCapacity(stream: Http2ClientStream, requested: number): number {
    if (this.terminating || this.terminated || stream.localEnded) {
      throw new TypeError("HTTP/2 stream cannot send more data");
    }
    const permitted = Math.min(
      requested,
      this.remoteMaximumFrameSize,
      this.connectionSendWindow,
      stream.sendWindow,
    );
    if (permitted <= 0) return 0;
    this.connectionSendWindow -= permitted;
    stream.sendWindow -= permitted;
    return permitted;
  }

  private async waitForFlowChange(stream: Http2ClientStream): Promise<void> {
    if (this.terminating || this.terminated || stream.localEnded) {
      throw new TypeError("HTTP/2 stream cannot send more data");
    }
    const signal = this.flowSignal.promise;
    await signal;
  }

  private notifyFlowChange(): void {
    const previous = this.flowSignal;
    this.flowSignal = Promise.withResolvers<void>();
    previous.resolve();
  }

  private async sendHeaderBlock(
    streamId: number,
    block: Uint8Array,
    endStream: boolean,
  ): Promise<void> {
    const frames: Http2Frame[] = [];
    let offset = 0;
    let first = true;
    do {
      const end = Math.min(offset + this.remoteMaximumFrameSize, block.length);
      const last = end === block.length;
      frames.push({
        type: first ? HTTP2_FRAME_HEADERS : HTTP2_FRAME_CONTINUATION,
        flags:
          (first && endStream ? HTTP2_FLAG_END_STREAM : 0) | (last ? HTTP2_FLAG_END_HEADERS : 0),
        streamId,
        payload: block.subarray(offset, end),
      });
      first = false;
      offset = end;
    } while (offset < block.length);
    await this.sendFrames(frames);
  }

  private sendClosedStreamReset(streamId: number): void {
    ignoreRejection(
      this.sendFrame({
        type: HTTP2_FRAME_RST_STREAM,
        flags: 0,
        streamId,
        payload: encodeHttp2ErrorCode(HTTP2_STREAM_CLOSED),
      }),
    );
  }

  private findStream(streamId: number, frameName: string): Http2ClientStream | null {
    const stream = this.streams.get(streamId);
    if (stream !== undefined) return stream;
    if ((streamId & 1) === 0 || streamId > this.highestOpenedStreamId) {
      throw new Http2WireError(
        frameName + " frame referred to an idle or server-initiated stream",
        HTTP2_PROTOCOL_ERROR,
      );
    }
    return null;
  }

  private async sendFrame(frame: Http2Frame): Promise<void> {
    return this.enqueueBytes(encodeHttp2Frame(frame, this.remoteMaximumFrameSize));
  }

  private async sendFrames(frames: readonly Http2Frame[]): Promise<void> {
    const encoded: Uint8Array[] = [];
    let length = 0;
    for (const frame of frames) {
      const bytes = encodeHttp2Frame(frame, this.remoteMaximumFrameSize);
      encoded.push(bytes);
      length += bytes.length;
    }
    return this.enqueueBytes(concatBytes(encoded, length));
  }

  private enqueueBytes(bytes: Uint8Array): Promise<void> {
    if (this.terminated) return Promise.reject(new TypeError("HTTP/2 connection is closed"));
    const result = Promise.withResolvers<void>();
    this.writes.push({ bytes, result });
    if (!this.writing) ignoreRejection(this.drainWrites());
    return result.promise;
  }

  private async drainWrites(): Promise<void> {
    if (this.writing) return;
    this.writing = true;
    try {
      while (this.writeOffset < this.writes.length) {
        const item = this.writes[this.writeOffset];
        this.writeOffset++;
        if (item === undefined) continue;
        try {
          await writeAll(this.connection, item.bytes);
          item.result.resolve();
        } catch (error) {
          item.result.reject(error);
          for (let index = this.writeOffset; index < this.writes.length; index++) {
            this.writes[index]?.result.reject(error);
          }
          this.writeOffset = this.writes.length;
          this.terminate(error, HTTP2_INTERNAL_ERROR, false);
        }
      }
    } finally {
      this.writes.length = 0;
      this.writeOffset = 0;
      this.writing = false;
    }
  }

  private async reserveStreamSlot(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.draining || this.terminating || this.terminated) {
      throw new Http2WireError("HTTP/2 connection is draining", HTTP2_REFUSED_STREAM);
    }
    if (this.streams.size + this.reservedSlots < this.remoteMaximumConcurrentStreams) {
      this.reservedSlots++;
      return;
    }
    if (this.slotWaiters.length - this.slotOffset >= this.options.maximumPendingRequests) {
      throw new LimitError("HTTP/2 pending request queue is full");
    }
    const waiter: SlotWaiter = {
      result: Promise.withResolvers<void>(),
      active: true,
      dispose: doNothing,
    };
    waiter.dispose = signal[abortSignalSubscribe](() => {
      if (!waiter.active) return;
      waiter.active = false;
      waiter.dispose();
      const index = this.slotWaiters.indexOf(waiter, this.slotOffset);
      if (index !== -1) this.slotWaiters.splice(index, 1);
      waiter.result.reject(signal.reason);
    });
    this.slotWaiters.push(waiter);
    try {
      await waiter.result.promise;
    } finally {
      waiter.dispose();
    }
  }

  private async waitUntilReady(signal: AbortSignal): Promise<void> {
    if (this.receivedSettings) return;
    signal.throwIfAborted();
    const result = Promise.withResolvers<void>();
    const dispose = signal[abortSignalSubscribe](() => result.reject(signal.reason));
    this.ready.then(result.resolve, result.reject);
    try {
      await result.promise;
    } finally {
      dispose();
    }
  }

  private wakeSlotWaiters(): void {
    while (
      this.streams.size + this.reservedSlots < this.remoteMaximumConcurrentStreams &&
      this.slotOffset < this.slotWaiters.length
    ) {
      const waiter = this.slotWaiters[this.slotOffset];
      this.slotOffset++;
      if (waiter === undefined || !waiter.active) continue;
      waiter.active = false;
      waiter.dispose();
      this.reservedSlots++;
      waiter.result.resolve();
    }
    if (this.slotOffset > 32 && this.slotOffset * 2 >= this.slotWaiters.length) {
      this.slotWaiters.splice(0, this.slotOffset);
      this.slotOffset = 0;
    }
  }

  private failSlotWaiters(reason: unknown): void {
    for (let index = this.slotOffset; index < this.slotWaiters.length; index++) {
      const waiter = this.slotWaiters[index];
      if (waiter === undefined || !waiter.active) continue;
      waiter.active = false;
      waiter.dispose();
      waiter.result.reject(reason);
    }
    this.slotWaiters.length = 0;
    this.slotOffset = 0;
  }

  private finishDrainIfIdle(): void {
    if (
      !this.draining ||
      this.streams.size !== 0 ||
      (!this.localGoAwaySent && !this.remoteGoAwayReceived) ||
      this.terminating ||
      this.terminated
    ) {
      return;
    }
    this.terminate(new TypeError("HTTP/2 connection drained"), HTTP2_NO_ERROR, false);
  }

  private terminate(reason: unknown, errorCode: number, sendGoAway: boolean): void {
    if (this.terminating || this.terminated) return;
    this.terminating = true;
    this.draining = true;
    this.readyResult.reject(reason);
    this.failSlotWaiters(reason);
    this.notifyFlowChange();
    for (const stream of this.streams.values()) stream.fail(reason);
    this.streams.clear();

    const finish = (): void => {
      if (this.terminated) return;
      this.terminated = true;
      this.connection.close();
      this.closedResult.resolve();
    };
    if (!sendGoAway || this.connection.closed) {
      finish();
      return;
    }
    this.sendFrame({
      type: HTTP2_FRAME_GOAWAY,
      flags: 0,
      streamId: 0,
      payload: encodeHttp2GoAway(0, errorCode),
    }).then(finish, finish);
  }
}
