import { Headers } from "../fetch/headers.ts";
import { asciiBytes, concatBytes, TextDecoder, utf8 } from "../core/encoding.ts";
import { DOMException, LimitError, ProtocolError } from "../core/errors.ts";
import { AbortController } from "../core/abort.ts";
import type { AbortSignal } from "../core/abort.ts";
import type {
  ByteConnection,
  CancelHandle,
  RandomSource,
  Scheduler,
  SocketConnector,
} from "../core/platform.ts";
import { addressOf } from "../http1/transport.ts";
import { BufferedReader, writeAll } from "../http1/io.ts";
import { defaultHeadLimits, readHead, validateWireValue } from "../http1/parser.ts";
import { createKey, validateHandshake } from "./handshake.ts";
import { closePayload, encodeFrame, parseClose, readFrame } from "./codec.ts";
import type { Frame } from "./codec.ts";
import type {
  SocketIncoming,
  SocketMessage,
  WebSocketHandshake,
  WebSocketSession,
  WebSocketTransport,
} from "./transport.ts";

export interface RawWebSocketOptions {
  connectTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  closeTimeoutMs?: number;
  maxFrameBytes?: number;
  maxMessageBytes?: number;
  outgoingFrameBytes?: number;
  maxFragments?: number;
}

export class RawWebSocketTransport implements WebSocketTransport {
  private readonly sockets: SocketConnector;
  private readonly random: RandomSource;
  private readonly scheduler: Scheduler;
  private readonly options: RawWebSocketOptions;
  private readonly sessions = new Set<RawWebSocketSession>();
  private readonly connecting = new Set<AbortController>();
  private closed = false;

  constructor(
    sockets: SocketConnector,
    random: RandomSource,
    scheduler: Scheduler,
    options: RawWebSocketOptions = {},
  ) {
    for (const value of [
      options.maxFrameBytes,
      options.maxMessageBytes,
      options.outgoingFrameBytes,
      options.maxFragments,
      options.connectTimeoutMs,
      options.handshakeTimeoutMs,
      options.closeTimeoutMs,
    ]) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 1))
        throw new RangeError("Invalid WebSocket limit or timeout");
    }
    this.sockets = sockets;
    this.random = random;
    this.scheduler = scheduler;
    this.options = options;
  }
  async connect(handshake: WebSocketHandshake, signal: AbortSignal): Promise<WebSocketSession> {
    signal.throwIfAborted();
    if (this.closed) throw new TypeError("WebSocket transport is closed");
    const controller = new AbortController();
    this.connecting.add(controller);
    const detach = signal.subscribe(() => controller.abort(signal.reason));
    try {
      return await this.open(handshake, controller.signal);
    } finally {
      detach();
      this.connecting.delete(controller);
    }
  }
  private async open(
    handshake: WebSocketHandshake,
    signal: AbortSignal,
  ): Promise<WebSocketSession> {
    const connection = await this.sockets.connect(
      addressOf(handshake.url, this.options.connectTimeoutMs ?? 30000),
      signal,
    );
    const dispose = signal.subscribe(() => connection.close());
    const timer = this.scheduler.delay(this.options.handshakeTimeoutMs ?? 30000, () =>
      connection.close(),
    );
    try {
      signal.throwIfAborted();
      const key = createKey(this.random);
      const target = handshake.url.pathname + handshake.url.search;
      if (/[^\x21-\x7e]/.test(target)) throw new TypeError("Invalid WebSocket HTTP target");
      validateWireValue(handshake.origin);
      let head =
        "GET " +
        (target || "/") +
        " HTTP/1.1\r\nHost: " +
        handshake.url.host +
        "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " +
        key +
        "\r\nSec-WebSocket-Version: 13\r\nOrigin: " +
        handshake.origin +
        "\r\n";
      if (handshake.protocols.length !== 0)
        head += "Sec-WebSocket-Protocol: " + handshake.protocols.join(", ") + "\r\n";
      await writeAll(connection, asciiBytes(head + "\r\n"));
      const reader = new BufferedReader(connection);
      let response = await readHead(reader);
      let informational = 0;
      while (response.status < 200 && response.status !== 101) {
        if (++informational > defaultHeadLimits.maxInformational)
          throw new LimitError("Too many interim upgrade responses");
        response = await readHead(reader);
      }
      const protocol = validateHandshake(
        response.status,
        new Headers(response.headers),
        key,
        handshake.protocols,
      );
      signal.throwIfAborted();
      const session = new RawWebSocketSession(
        connection,
        reader,
        protocol,
        this.random,
        this.scheduler,
        this.options,
        (item) => this.sessions.delete(item),
      );
      this.sessions.add(session);
      return session;
    } catch (error) {
      connection.close();
      throw signal.aborted ? signal.reason : error;
    } finally {
      timer.cancel();
      dispose();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const controller of this.connecting)
      controller.abort(new TypeError("WebSocket transport is closed"));
    for (const session of this.sessions) session.abort();
  }
}

class RawWebSocketSession implements WebSocketSession {
  readonly protocol: string;
  readonly extensions = "";
  private readonly connection: ByteConnection;
  private readonly reader: BufferedReader;
  private readonly random: RandomSource;
  private readonly scheduler: Scheduler;
  private readonly options: RawWebSocketOptions;
  private writeTail: Promise<void> = Promise.resolve();
  private sentClose = false;
  private receivedClose = false;
  private ended = false;
  private closeTimer: CancelHandle | null = null;
  private messageOpcode: 0 | 1 | 2 = 0;
  private chunks: Uint8Array[] = [];
  private messageSize = 0;
  private decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  private textChunks: string[] = [];
  private fragments = 0;
  private readonly onEnd: (session: RawWebSocketSession) => void;

  constructor(
    connection: ByteConnection,
    reader: BufferedReader,
    protocol: string,
    random: RandomSource,
    scheduler: Scheduler,
    options: RawWebSocketOptions,
    onEnd: (session: RawWebSocketSession) => void,
  ) {
    this.onEnd = onEnd;
    this.connection = connection;
    this.reader = reader;
    this.protocol = protocol;
    this.random = random;
    this.scheduler = scheduler;
    this.options = options;
  }
  private write(frame: Frame, owned = false): Promise<void> {
    const write = this.writeTail.then(async () => {
      if (this.ended) throw new DOMException("WebSocket transport is closed", "InvalidStateError");
      for (const part of encodeFrame(frame, this.random, true, owned))
        await writeAll(this.connection, part);
    });
    this.writeTail = write;
    write.catch(() => {});
    return write;
  }
  async send(message: SocketMessage): Promise<void> {
    if (this.sentClose || this.ended)
      throw new DOMException("WebSocket is closing", "InvalidStateError");
    const payload = message.kind === "text" ? utf8.encode(message.data) : message.data;
    const limit = this.options.outgoingFrameBytes ?? 65536;
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Invalid outgoingFrameBytes");
    let offset = 0;
    let first = true;
    do {
      if (this.sentClose || this.ended)
        throw new DOMException("Peer closed during send", "InvalidStateError");
      const end = Math.min(offset + limit, payload.length);
      await this.write(
        {
          fin: end === payload.length,
          opcode: first ? (message.kind === "text" ? 1 : 2) : 0,
          payload: payload.subarray(offset, end),
        },
        true,
      );
      offset = end;
      first = false;
    } while (offset < payload.length);
  }
  async close(code: number | null, reason: string): Promise<void> {
    if (this.sentClose || this.ended) return;
    const payload = closePayload(code, reason);
    this.sentClose = true;
    this.closeTimer = this.scheduler.delay(this.options.closeTimeoutMs ?? 5000, () => this.abort());
    await this.write({ fin: true, opcode: 8, payload }, true);
  }

  abort(): void {
    if (this.ended) return;
    this.ended = true;
    this.closeTimer?.cancel();
    this.connection.close();
    this.onEnd(this);
  }
  async next(): Promise<SocketIncoming> {
    if (this.ended)
      return {
        kind: "close",
        code: 1006,
        reason: "",
        wasClean: false,
        failed: !this.receivedClose,
      };
    try {
      while (true) {
        const frame = await readFrame(
          this.reader,
          false,
          this.options.maxFrameBytes ?? 16 * 1024 * 1024,
        );
        if (frame.opcode === 9) {
          if (!this.sentClose)
            await this.write({ fin: true, opcode: 10, payload: frame.payload }, true);
          continue;
        }
        if (frame.opcode === 10) continue;
        if (frame.opcode === 8) {
          const peer = parseClose(frame.payload);
          this.receivedClose = true;
          if (!this.sentClose) await this.close(peer.code === 1005 ? null : peer.code, peer.reason);
          // Both close frames have been exchanged. No more application bytes are accepted.
          this.abort();
          return {
            kind: "close",
            code: peer.code,
            reason: peer.reason,
            wasClean: true,
            failed: false,
          };
        }
        if (frame.opcode === 0) {
          if (this.messageOpcode === 0) throw new ProtocolError("Unexpected continuation frame");
        } else {
          if (this.messageOpcode !== 0)
            throw new ProtocolError("New data frame during a fragmented message");
          this.messageOpcode = frame.opcode;
          this.chunks = [];
          this.textChunks = [];
          this.messageSize = 0;
          this.fragments = 0;
          this.decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
        }
        if (++this.fragments > (this.options.maxFragments ?? 65536))
          throw new LimitError("Too many WebSocket fragments");
        this.messageSize += frame.payload.length;
        if (this.messageSize > (this.options.maxMessageBytes ?? 16 * 1024 * 1024))
          throw new LimitError("WebSocket message exceeds configured limit");
        if (this.messageOpcode === 1) {
          const text = this.decoder.decode(frame.payload, { stream: !frame.fin });
          if (text.length !== 0) this.textChunks.push(text);
        } else if (frame.payload.length !== 0) this.chunks.push(frame.payload);
        if (frame.fin) {
          const message: SocketMessage =
            this.messageOpcode === 1
              ? { kind: "text", data: this.textChunks.join("") }
              : { kind: "binary", data: concatBytes(this.chunks, this.messageSize) };
          this.messageOpcode = 0;
          this.chunks = [];
          this.textChunks = [];
          this.messageSize = 0;
          return message;
        }
      }
    } catch (error) {
      if (!this.sentClose && !this.ended) {
        const code = error instanceof LimitError ? 1009 : error instanceof TypeError ? 1007 : 1002;
        try {
          await this.close(code, "");
        } catch {
          /* A broken transport cannot carry a failure close. */
        }
      }
      this.abort();
      return { kind: "close", code: 1006, reason: "", wasClean: false, failed: true };
    }
  }
}
