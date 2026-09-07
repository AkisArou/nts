import { addressOf } from "../http/address.ts";
import type { FetchTransport, TransportRequest, TransportResponse } from "../fetch/transport.ts";
import { Http1Transport } from "../http1/transport.ts";
import type { Http1Options } from "../http1/transport.ts";
import { Http2Transport } from "../http2/transport.ts";
import type { Http2TransportOptions } from "../http2/transport.ts";
import { connectNegotiated, offeredProtocols } from "../provider/primitives.ts";
import type {
  ByteConnection,
  ConnectAddress,
  NegotiatedConnection,
  ProtocolPreference,
  Scheduler,
  SocketConnector,
} from "../provider/primitives.ts";
import { AbortController } from "../core/abort.ts";
import type { AbortSignal } from "../core/abort.ts";

/** The peer selected an application protocol this connection was not opened for. */
export class ProtocolMismatchError extends Error {
  readonly expected: string;
  readonly selected: string | null;

  constructor(expected: string, selected: string | null) {
    super(
      "The peer selected " +
        (selected === null ? "no application protocol" : selected) +
        " where " +
        expected +
        " was required",
    );
    this.name = "ProtocolMismatchError";
    this.expected = expected;
    this.selected = selected;
  }
}

const HTTP_1_1 = "http/1.1";
const H2 = "h2";

export const defaultProtocolPreference: ProtocolPreference = {
  ordered: [H2, HTTP_1_1],
  whenUnreportable: HTTP_1_1,
};

export interface ProtocolSelectingTransportOptions {
  readonly scheduler: Scheduler;
  readonly connector: SocketConnector;
  /** Protocols offered to a connector that reports its selection. */
  readonly preference?: ProtocolPreference;
  /**
   * Cleartext origins never negotiate, so HTTP/2 there is prior knowledge rather
   * than a discovery. It is opt-in per this transport and is never inferred from a
   * URL, because sending the connection preface to an HTTP/1.1 peer is not a
   * recoverable mistake.
   */
  readonly cleartextHttp2?: boolean;
  readonly http1?: Http1Options;
  readonly http2?: Http2TransportOptions;
  /** Retained protocol decisions, one per canonical origin. */
  readonly maxOrigins?: number;
}

interface Engine {
  readonly protocol: string;
  readonly transport: FetchTransport;
  drain(): Promise<void>;
  close(): void;
}

/**
 * Connector that gives an engine the connection already negotiated for it.
 *
 * The first connect adopts that stream, so selecting a protocol costs no extra
 * round trip and no second connection: the decision is made on the connection the
 * engine then uses. Later connections for the same origin negotiate again and must
 * agree; a peer that answers differently produces a typed mismatch rather than an
 * engine speaking into a stream that is not what it thinks it is.
 */
class AdoptingConnector implements SocketConnector {
  readonly reportsNegotiatedProtocol = false;
  #adopted: ByteConnection | null;
  readonly #expected: string;
  readonly #connector: SocketConnector;
  readonly #offered: readonly string[];

  constructor(
    adopted: ByteConnection,
    expected: string,
    connector: SocketConnector,
    offered: readonly string[],
  ) {
    this.#adopted = adopted;
    this.#expected = expected;
    this.#connector = connector;
    this.#offered = offered;
  }

  async connect(address: ConnectAddress, signal: AbortSignal): Promise<ByteConnection> {
    const adopted = this.#adopted;
    if (adopted !== null) {
      this.#adopted = null;
      signal.throwIfAborted();
      return adopted;
    }
    const result = await connectNegotiated(
      this.#connector,
      { ...address, alpnProtocols: this.#offered },
      signal,
    );
    if (!address.secure) return result.connection;
    // A reported selection that disagrees is a mismatch. An unreported one is not:
    // the contract means such a connector was offered exactly one protocol, so
    // there was nothing else it could have chosen.
    if (result.protocol !== null && result.protocol !== this.#expected) {
      result.connection.close();
      throw new ProtocolMismatchError(this.#expected, result.protocol);
    }
    return result.connection;
  }

  /** Releases an adopted connection that no engine ever took. */
  discard(): void {
    const adopted = this.#adopted;
    this.#adopted = null;
    adopted?.close();
  }
}

/**
 * Chooses HTTP/1.1 or HTTP/2 from what TLS actually negotiated, once per origin.
 *
 * The protocol is decided on a connection that has already been established and is
 * then handed to the engine that speaks it. Nothing reconnects to change engines and
 * nothing infers a protocol from request intent or from a URL scheme.
 */
export class ProtocolSelectingTransport implements FetchTransport {
  readonly #options: ProtocolSelectingTransportOptions;
  readonly #preference: ProtocolPreference;
  readonly #engines = new Map<string, Engine>();
  readonly #selecting = new Map<string, Promise<Engine>>();
  readonly #maxOrigins: number;
  #accepting = true;
  #drainResult: Promise<void> | null = null;

  constructor(options: ProtocolSelectingTransportOptions) {
    this.#options = options;
    this.#preference = options.preference ?? defaultProtocolPreference;
    this.#maxOrigins = options.maxOrigins ?? 64;
    if (!Number.isSafeInteger(this.#maxOrigins) || this.#maxOrigins < 1) {
      throw new RangeError("maxOrigins must be a positive safe integer");
    }
  }

  async dispatch(request: TransportRequest): Promise<TransportResponse> {
    if (!this.#accepting) throw new TypeError("Protocol-selecting transport is closed");
    const engine = await this.#engineFor(request);
    return engine.transport.dispatch(request);
  }

  /** The protocol chosen for an origin, or null while none has been decided. */
  protocolFor(origin: string): string | null {
    return this.#engines.get(origin)?.protocol ?? null;
  }

  async drain(): Promise<void> {
    if (this.#drainResult !== null) return this.#drainResult;
    this.#accepting = false;
    this.#drainResult = this.#finishDrain();
    return this.#drainResult;
  }

  close(): void {
    this.#accepting = false;
    for (const engine of this.#engines.values()) engine.close();
    this.#engines.clear();
    this.#selecting.clear();
  }

  async #finishDrain(): Promise<void> {
    // A selection still in flight owns a connection that no engine holds yet, so it
    // is awaited before the engines are drained rather than dropped.
    const selecting = [...this.#selecting.values()];
    await Promise.all(
      selecting.map((selection) =>
        selection.then(
          () => {},
          () => {},
        ),
      ),
    );
    const draining: Promise<void>[] = [];
    for (const engine of this.#engines.values()) draining.push(engine.drain());
    await Promise.all(draining);
    this.#engines.clear();
  }

  #originOf(request: TransportRequest): string {
    const url = request.url;
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new TypeError("Protocol selection requires an HTTP(S) URL");
    }
    if (url.host === "") throw new TypeError("Protocol selection requires a nonempty host");
    return url.protocol + "//" + url.host;
  }

  async #engineFor(request: TransportRequest): Promise<Engine> {
    const origin = this.#originOf(request);
    const existing = this.#engines.get(origin);
    if (existing !== undefined) return existing;
    // Concurrent first requests to one origin negotiate once, not once each.
    const pending = this.#selecting.get(origin);
    if (pending !== undefined) return pending;
    const selection = this.#select(origin, request);
    this.#selecting.set(origin, selection);
    selection.then(
      () => this.#selecting.delete(origin),
      () => this.#selecting.delete(origin),
    );
    return selection;
  }

  async #select(origin: string, request: TransportRequest): Promise<Engine> {
    if (this.#engines.size >= this.#maxOrigins) {
      throw new TypeError("Protocol-selecting transport reached its origin limit");
    }
    const secure = request.url.protocol === "https:";
    if (!secure) {
      // Cleartext negotiates nothing. HTTP/2 here is configured prior knowledge.
      const engine = this.#buildEngine(
        this.#options.cleartextHttp2 === true ? H2 : HTTP_1_1,
        null,
        [],
      );
      this.#retain(origin, engine);
      return engine;
    }

    const offered = offeredProtocols(this.#options.connector, this.#preference);
    const address = addressOf(request.url, this.#options.http1?.connectTimeoutMs ?? 30000, offered);
    const cancellation = new AbortController();
    const negotiated: NegotiatedConnection = await connectNegotiated(
      this.#options.connector,
      address,
      cancellation.signal,
    );
    if (!this.#accepting) {
      negotiated.connection.close();
      throw new TypeError("Protocol-selecting transport is closed");
    }
    const protocol = negotiated.protocol ?? this.#preference.whenUnreportable;
    if (protocol !== H2 && protocol !== HTTP_1_1) {
      negotiated.connection.close();
      throw new ProtocolMismatchError(this.#preference.whenUnreportable, negotiated.protocol);
    }
    const engine = this.#buildEngine(protocol, negotiated.connection, offered);
    this.#retain(origin, engine);
    return engine;
  }

  #retain(origin: string, engine: Engine): void {
    this.#engines.set(origin, engine);
  }

  #buildEngine(
    protocol: string,
    adopted: ByteConnection | null,
    offered: readonly string[],
  ): Engine {
    const base = this.#options.connector;
    const adopting =
      adopted === null ? null : new AdoptingConnector(adopted, protocol, base, offered);
    const connector: SocketConnector = adopting ?? base;
    // An engine may be retired before it ever connects, and the adopted stream is
    // then owned by nothing. Retiring the engine releases it in both paths.
    const release = (): void => adopting?.discard();
    if (protocol === H2) {
      const transport = new Http2Transport(connector, this.#options.scheduler, this.#options.http2);
      return {
        protocol,
        transport,
        drain: () => transport.drain().finally(release),
        close: () => {
          transport.close();
          release();
        },
      };
    }
    const transport = new Http1Transport(connector, this.#options.scheduler, this.#options.http1);
    return {
      protocol,
      transport,
      drain: () => transport.drain().finally(release),
      close: () => {
        transport.close();
        release();
      },
    };
  }
}
