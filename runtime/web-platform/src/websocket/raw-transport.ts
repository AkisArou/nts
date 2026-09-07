import { Headers } from "../fetch/headers.ts";
import { concatBytes, decodeUTF8, encodeByteString, TextDecoder, utf8 } from "../core/encoding.ts";
import { DOMException, LimitError, ProtocolError } from "../core/errors.ts";
import { AbortController } from "../core/abort.ts";
import type { AbortSignal } from "../core/abort.ts";
import type {
  ByteConnection,
  CancelHandle,
  RandomSource,
  Scheduler,
  SocketConnector,
} from "../provider/primitives.ts";
import { addressOf } from "../http/address.ts";
import { BufferedReader, writeAll } from "../http1/io.ts";
import { defaultHeadLimits, readHead, validateWireValue } from "../http1/parser.ts";
import { createKey, validateHandshake, type ValidatedWebSocketHandshake } from "./handshake.ts";
import { closePayload, encodeFrame, parseClose, readFrame } from "./codec.ts";
import type { Frame } from "./codec.ts";
import { perMessageDeflateOffer, PerMessageDeflate } from "./permessage-deflate.ts";
import type { PerMessageDeflateNegotiation } from "./permessage-deflate.ts";
import type {
  SocketIncoming,
  SocketMessage,
  WebSocketDeflateProvider,
  WebSocketHandshake,
  WebSocketSession,
  WebSocketTransport,
} from "./transport.ts";
import { abortSignalSubscribe } from "../core/abort.ts";

export interface RawWebSocketOptions {
  connectTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  closeTimeoutMs?: number;
  maxFrameBytes?: number;
  maxMessageBytes?: number;
  maxCompressedMessageBytes?: number;
  outgoingFrameBytes?: number;
  maxFragments?: number;
}

/** Which end of a connection a session is. Masking is the only framing asymmetry. */
export type WebSocketRole = "client" | "server";

export class RawWebSocketTransport implements WebSocketTransport {
  private readonly sockets: SocketConnector;
  private readonly random: RandomSource;
  private readonly scheduler: Scheduler;
  private readonly options: RawWebSocketOptions;
  private readonly deflate: WebSocketDeflateProvider | undefined;
  private readonly sessions = new Set<RawWebSocketSession>();
  private readonly connecting = new Set<AbortController>();
  private closed = false;

  constructor(
    sockets: SocketConnector,
    random: RandomSource,
    scheduler: Scheduler,
    options: RawWebSocketOptions = {},
    deflate?: WebSocketDeflateProvider,
  ) {
    for (const value of [
      options.maxFrameBytes,
      options.maxMessageBytes,
      options.maxCompressedMessageBytes,
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
    this.deflate = deflate;
  }
  async connect(handshake: WebSocketHandshake, signal: AbortSignal): Promise<WebSocketSession> {
    signal.throwIfAborted();
    if (this.closed) throw new TypeError("WebSocket transport is closed");
    const controller = new AbortController();
    this.connecting.add(controller);
    const detach = signal[abortSignalSubscribe](() => controller.abort(signal.reason));
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
      addressOf(handshake.url, this.options.connectTimeoutMs ?? 30000, ["http/1.1"]),
      signal,
    );
    const dispose = signal[abortSignalSubscribe](() => connection.close());
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
      if (this.deflate !== undefined) {
        head += "Sec-WebSocket-Extensions: " + perMessageDeflateOffer + "\r\n";
      }
      await writeAll(connection, encodeByteString(head + "\r\n"));
      const reader = new BufferedReader(connection);
      let response = await readHead(reader);
      let informational = 0;
      while (response.status < 200 && response.status !== 101) {
        if (++informational > defaultHeadLimits.maxInformational)
          throw new LimitError("Too many interim upgrade responses");
        response = await readHead(reader);
      }
      const validated = validateHandshake(
        response.status,
        new Headers(response.headers),
        key,
        handshake.protocols,
        this.deflate !== undefined,
      );
      signal.throwIfAborted();
      const session = new RawWebSocketSession(
        connection,
        reader,
        validated,
        this.deflate,
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
  readonly extensions: string;
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
  private messageCompressed = false;
  private chunks: Uint8Array[] = [];
  private messageSize = 0;
  private decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  private textChunks: string[] = [];
  private fragments = 0;
  private readonly compression: PerMessageDeflate | null;
  private readonly onEnd: (session: RawWebSocketSession) => void;
  /**
   * Which end of the connection this is.
   *
   * RFC 6455 makes masking the one asymmetry in the framing: a client masks every
   * frame it sends and a server masks none, and each rejects the other spelling. The
   * message engine is otherwise identical in both directions, so the role is a field
   * rather than a reason for a second implementation of fragmentation, UTF-8
   * validation, compression and the close handshake.
   */
  private readonly role: WebSocketRole;

  constructor(
    connection: ByteConnection,
    reader: BufferedReader,
    handshake: ValidatedWebSocketHandshake,
    deflate: WebSocketDeflateProvider | undefined,
    random: RandomSource,
    scheduler: Scheduler,
    options: RawWebSocketOptions,
    onEnd: (session: RawWebSocketSession) => void,
    role: WebSocketRole = "client",
  ) {
    this.role = role;
    this.onEnd = onEnd;
    this.connection = connection;
    this.reader = reader;
    this.protocol = handshake.protocol;
    this.extensions = handshake.extensions;
    this.compression =
      handshake.perMessageDeflate === null
        ? null
        : new PerMessageDeflate(requireDeflate(deflate), handshake.perMessageDeflate);
    this.random = random;
    this.scheduler = scheduler;
    this.options = options;
  }
  private write(frame: Frame, owned = false): Promise<void> {
    const write = this.writeTail.then(async () => {
      if (this.ended) throw new DOMException("WebSocket transport is closed", "InvalidStateError");
      for (const part of encodeFrame(frame, this.random, this.role === "client", owned))
        await writeAll(this.connection, part);
    });
    this.writeTail = write;
    write.catch(() => {});
    return write;
  }
  async send(message: SocketMessage): Promise<void> {
    if (this.sentClose || this.ended)
      throw new DOMException("WebSocket is closing", "InvalidStateError");
    const source = message.kind === "text" ? utf8.encode(message.data) : message.data;
    const messageLimit = this.options.maxMessageBytes ?? 16 * 1024 * 1024;
    if (source.length > messageLimit) {
      throw new LimitError("WebSocket message exceeds configured limit");
    }
    const compressed = this.compression !== null;
    const payload = compressed
      ? await this.compression.compress(
          source,
          this.options.maxCompressedMessageBytes ?? messageLimit + 65536,
        )
      : source;
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
          compressed: compressed && first,
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
    this.compression?.close();
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
          this.role === "server",
          this.options.maxFrameBytes ?? 16 * 1024 * 1024,
          this.compression !== null,
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
          this.messageCompressed = frame.compressed ?? false;
          this.chunks = [];
          this.textChunks = [];
          this.messageSize = 0;
          this.fragments = 0;
          this.decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
        }
        if (++this.fragments > (this.options.maxFragments ?? 65536))
          throw new LimitError("Too many WebSocket fragments");
        this.messageSize += frame.payload.length;
        const messageLimit = this.options.maxMessageBytes ?? 16 * 1024 * 1024;
        const wireLimit = this.messageCompressed
          ? (this.options.maxCompressedMessageBytes ?? messageLimit + 65536)
          : messageLimit;
        if (this.messageSize > wireLimit)
          throw new LimitError("WebSocket message exceeds configured limit");
        if (this.messageCompressed) {
          if (frame.payload.length !== 0) this.chunks.push(frame.payload);
        } else if (this.messageOpcode === 1) {
          const text = this.decoder.decode(frame.payload, { stream: !frame.fin });
          if (text.length !== 0) this.textChunks.push(text);
        } else if (frame.payload.length !== 0) this.chunks.push(frame.payload);
        if (frame.fin) {
          let message: SocketMessage;
          if (this.messageCompressed) {
            const compression = this.compression;
            if (compression === null)
              throw new ProtocolError("Compressed message was not negotiated");
            const inflated = await compression.decompress(
              concatBytes(this.chunks, this.messageSize),
              messageLimit,
            );
            message =
              this.messageOpcode === 1
                ? { kind: "text", data: decodeUTF8(inflated, true, true) }
                : { kind: "binary", data: inflated };
          } else {
            message =
              this.messageOpcode === 1
                ? { kind: "text", data: this.textChunks.join("") }
                : { kind: "binary", data: concatBytes(this.chunks, this.messageSize) };
          }
          this.messageOpcode = 0;
          this.messageCompressed = false;
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

function requireDeflate(provider: WebSocketDeflateProvider | undefined): WebSocketDeflateProvider {
  if (provider === undefined) {
    throw new ProtocolError("permessage-deflate was negotiated without a provider");
  }
  return provider;
}

/**
 * @internal Adopt an already-upgraded connection as the server end of a session.
 *
 * The handshake is the caller's: `acceptWebSocketUpgrade` decides the response and the
 * embedding HTTP server writes it and hands over the socket. What arrives here is a
 * byte stream that is already a WebSocket, so this only has to drive the shared
 * message engine from the other side.
 *
 * `reader` must be the reader that consumed the request head, so bytes a client sent
 * immediately after its handshake are not lost between the two.
 */
/**
 * Drives a client session over a connection somebody else obtained and validated.
 *
 * The mirror of {@link adoptServerWebSocketSession}, and it exists for the same reason:
 * masking is the only asymmetry in the framing, so the message engine takes a role
 * rather than being written twice. What differs here is only where the connection came
 * from — a transport that dispatched an upgrade through the HTTP stack ends up holding
 * exactly what {@link RawWebSocketTransport} holds after its own handshake.
 */
export function adoptClientWebSocketSession(options: {
  readonly connection: ByteConnection;
  readonly reader: BufferedReader;
  readonly handshake: ValidatedWebSocketHandshake;
  readonly deflate?: WebSocketDeflateProvider | undefined;
  readonly random: RandomSource;
  readonly scheduler: Scheduler;
  readonly transport?: RawWebSocketOptions;
  readonly onEnd?: () => void;
}): WebSocketSession {
  const end = options.onEnd;
  return new RawWebSocketSession(
    options.connection,
    options.reader,
    options.handshake,
    options.deflate,
    options.random,
    options.scheduler,
    options.transport ?? {},
    () => {
      if (end !== undefined) end();
    },
    "client",
  );
}

export function adoptServerWebSocketSession(options: {
  readonly connection: ByteConnection;
  readonly reader: BufferedReader;
  readonly protocol: string;
  readonly extensions: string;
  readonly perMessageDeflate: PerMessageDeflateNegotiation | null;
  readonly deflate?: WebSocketDeflateProvider | undefined;
  readonly random: RandomSource;
  readonly scheduler: Scheduler;
  readonly transport?: RawWebSocketOptions;
  readonly onEnd?: () => void;
}): WebSocketSession {
  const end = options.onEnd;
  return new RawWebSocketSession(
    options.connection,
    options.reader,
    {
      protocol: options.protocol,
      extensions: options.extensions,
      perMessageDeflate: options.perMessageDeflate,
    },
    options.deflate,
    options.random,
    options.scheduler,
    options.transport ?? {},
    () => {
      if (end !== undefined) end();
    },
    "server",
  );
}
