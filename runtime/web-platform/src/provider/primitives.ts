import type { AbortSignal } from "../core/abort.ts";

/** A provider-owned cancellation token. Repeated cancellation is harmless. */
export interface CancelHandle {
  cancel(): void;
}

/** enqueue MUST enqueue a task, never invoke inline. Timer cancellation is idempotent. */
export interface Scheduler {
  enqueue(task: () => void): void;

  delay(milliseconds: number, task: () => void): CancelHandle;

  reportError(error: unknown): void;
}

export interface RandomSource {
  fill(bytes: Uint8Array): void;
}

export interface URLRecord {
  readonly href: string;
  readonly protocol: string;
  readonly hostname: string;
  readonly port: string;
  readonly host: string;
  readonly origin: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly username: string;
  readonly password: string;
}

/** Bind the project's WHATWG URL implementation here, not java.net.URI. */
export interface URLParser {
  parse(input: string, base?: string): URLRecord;
}

export interface ConnectAddress {
  /** Logical authority used for pooling, HTTP Host, TLS SNI and certificate verification. */
  readonly hostname: string; // IPv6 has no surrounding brackets at this boundary.
  readonly port: number;
  readonly secure: boolean;
  readonly connectTimeoutMs: number;
  /** Ordered application protocols required of a TLS connection. */
  readonly alpnProtocols?: readonly string[];
  /** Optional physical endpoint selected by the shared resolver; never use it as TLS identity. */
  readonly resolvedAddress?: string;
  readonly resolvedFamily?: DnsAddressFamily;
}

export type DnsAddressFamily = 4 | 6;

export interface DnsAddress {
  readonly address: string;
  readonly family: DnsAddressFamily;
  /** Provider-reported positive-cache lifetime. Zero keeps the answer request-local. */
  readonly ttlMilliseconds: number;
}

export interface DnsResolveOptions {
  readonly families: readonly DnsAddressFamily[];
  /** Provider must not materialize more records than this shared-policy bound. */
  readonly maximumAddresses: number;
}

/** Provider-owned nonblocking DNS primitive. Shared code owns cache and selection policy. */
export interface DnsResolver {
  resolve(
    hostname: string,
    options: DnsResolveOptions,
    signal: AbortSignal,
  ): Promise<readonly DnsAddress[]>;
}

/**
 * One concurrent read and one concurrent write are allowed. No overlapping reads
 * or overlapping writes. read() transfers ownership of a nonempty chunk of at
 * most maxBytes bytes; null means EOF. write() borrows data until it settles and
 * returns 1..data.length. close() is idempotent and MUST interrupt pending I/O.
 */
export interface ByteConnection {
  readonly closed: boolean;

  read(maxBytes: number): Promise<Uint8Array | null>;

  write(data: Uint8Array): Promise<number>;

  close(): void;
}

export interface SocketConnector {
  connect(address: ConnectAddress, signal: AbortSignal): Promise<ByteConnection>;

  /**
   * Optional negotiation capability. Declared here rather than only on
   * {@link NegotiatingSocketConnector} so a provider author reading the interface
   * they implement can see that it exists, and so callers ask a declared question
   * instead of probing for a member the type does not mention.
   */
  readonly reportsNegotiatedProtocol?: boolean;

  connectNegotiated?(address: ConnectAddress, signal: AbortSignal): Promise<NegotiatedConnection>;
}

/**
 * A connected byte stream together with what TLS actually negotiated for it.
 *
 * The selection is reported on the connect result rather than as a field on
 * `ByteConnection`, so a raw byte stream carries no TLS concept it has no use for,
 * and the asymmetry stays visible: the caller offers a list and is told the one that
 * was chosen.
 */
export interface NegotiatedConnection {
  readonly connection: ByteConnection;
  /**
   * The application protocol TLS selected, or null when nothing was negotiated.
   *
   * Null is unambiguous only because of the contract on
   * {@link NegotiatingSocketConnector}: a connector that cannot report a selection
   * is never offered a choice, so null means cleartext or a single known answer and
   * never "negotiation happened and this provider cannot say what it chose".
   */
  readonly protocol: string | null;
  /**
   * dNSName subject-alternative names as presented by the peer certificate, empty
   * for cleartext. Reusing a connection for a second origin is sound only when the
   * certificate covers it, so a pool that coalesces on hostname alone is a
   * cross-origin routing defect; an empty list simply cannot coalesce.
   */
  readonly certificateNames: readonly string[];
}

/**
 * A connector that reports what TLS negotiated.
 *
 * `reportsNegotiatedProtocol` is a capability declaration rather than documentation.
 * Shared policy may offer more than one protocol in `ConnectAddress.alpnProtocols`
 * only to a connector that declares `true`. A provider that cannot report the
 * selection declares `false` and is then offered exactly one protocol, so an absent
 * answer cannot be confused with an unreported one.
 *
 * This is not hypothetical caution. Android exposes
 * `SSLSocket.getApplicationProtocol` only from API 29 while this project targets API
 * 26; the method compiles against the API-26 stub and is absent on the device. A
 * provider there that offered `["h2", "http/1.1"]`, negotiated h2, and reported
 * nothing would have shared policy select HTTP/1.1 and speak it into an h2
 * connection.
 *
 * The declaration is therefore a property of this connector instance, answerable at
 * runtime, and never a build-time constant: one Android build runs on both API 26 and
 * API 29, so a provider decides per instance rather than needing two providers.
 */
export interface NegotiatingSocketConnector extends SocketConnector {
  readonly reportsNegotiatedProtocol: boolean;

  connectNegotiated(address: ConnectAddress, signal: AbortSignal): Promise<NegotiatedConnection>;
}

/** Ordered protocols to offer, and the single one to request when none can be reported. */
export interface ProtocolPreference {
  /** Offered in order to a connector that reports its selection. */
  readonly ordered: readonly string[];
  /**
   * Requested alone when the connector cannot report. Named explicitly rather than
   * taken from a position in `ordered`, because the safe single choice is the most
   * compatible protocol and not the most preferred one.
   */
  readonly whenUnreportable: string;
}

export function isNegotiatingSocketConnector(
  connector: SocketConnector,
): connector is NegotiatingSocketConnector {
  return (
    typeof connector.reportsNegotiatedProtocol === "boolean" &&
    connector.connectNegotiated !== undefined
  );
}

/**
 * The protocols shared policy is allowed to offer this connector.
 *
 * This is where the contract is enforced, so that a provider cannot be merely
 * careful about it and every caller gets the same rule.
 */
export function offeredProtocols(
  connector: SocketConnector,
  preference: ProtocolPreference,
): readonly string[] {
  if (preference.ordered.length === 0) throw new TypeError("A protocol preference cannot be empty");
  if (!preference.ordered.includes(preference.whenUnreportable)) {
    throw new TypeError("The unreportable protocol must be one of the offered protocols");
  }
  if (isNegotiatingSocketConnector(connector) && connector.reportsNegotiatedProtocol) {
    return preference.ordered;
  }
  return [preference.whenUnreportable];
}

/**
 * Connect through any connector and describe the result uniformly.
 *
 * A connector that does not report a selection yields `protocol: null` and no
 * certificate names, which is exactly what the contract above makes safe: it was
 * offered one protocol, so there is nothing it could have chosen instead.
 */
export async function connectNegotiated(
  connector: SocketConnector,
  address: ConnectAddress,
  signal: AbortSignal,
): Promise<NegotiatedConnection> {
  if (isNegotiatingSocketConnector(connector)) {
    return connector.connectNegotiated(address, signal);
  }
  const connection = await connector.connect(address, signal);
  return { connection, protocol: null, certificateNames: [] };
}

/**
 * A TLS upgrader that reports what it negotiated.
 *
 * Proxied TLS reaches the peer through {@link TlsUpgrader} rather than through a
 * connector, so the same declaration and the same contract have to exist here or
 * automatic protocol selection would silently stop working the moment a tunnel is
 * involved. `reportsNegotiatedProtocol` carries the identical meaning and the
 * identical per-instance requirement.
 */
export interface NegotiatingTlsUpgrader extends TlsUpgrader {
  readonly reportsNegotiatedProtocol: boolean;

  upgradeNegotiated(
    connection: ByteConnection,
    target: ConnectAddress,
    signal: AbortSignal,
  ): Promise<NegotiatedConnection>;
}

export function isNegotiatingTlsUpgrader(
  upgrader: TlsUpgrader,
): upgrader is NegotiatingTlsUpgrader {
  return (
    typeof upgrader.reportsNegotiatedProtocol === "boolean" &&
    upgrader.upgradeNegotiated !== undefined
  );
}

/** The protocols shared policy may offer this upgrader, under the same contract. */
export function offeredUpgradeProtocols(
  upgrader: TlsUpgrader,
  preference: ProtocolPreference,
): readonly string[] {
  if (preference.ordered.length === 0) throw new TypeError("A protocol preference cannot be empty");
  if (!preference.ordered.includes(preference.whenUnreportable)) {
    throw new TypeError("The unreportable protocol must be one of the offered protocols");
  }
  if (isNegotiatingTlsUpgrader(upgrader) && upgrader.reportsNegotiatedProtocol) {
    return preference.ordered;
  }
  return [preference.whenUnreportable];
}

/** Upgrade through any upgrader and describe the result uniformly. */
export async function upgradeNegotiated(
  upgrader: TlsUpgrader,
  connection: ByteConnection,
  target: ConnectAddress,
  signal: AbortSignal,
): Promise<NegotiatedConnection> {
  if (isNegotiatingTlsUpgrader(upgrader)) {
    return upgrader.upgradeNegotiated(connection, target, signal);
  }
  const upgraded = await upgrader.upgrade(connection, target, signal);
  return { connection: upgraded, protocol: null, certificateNames: [] };
}

/**
 * Provider-owned TLS over an already connected byte stream.
 *
 * The target carries the logical hostname used for SNI and certificate
 * verification. The upgrader consumes the input connection immediately and must
 * close it if the handshake fails; callers never reuse the plaintext handle.
 */
export interface TlsUpgrader {
  upgrade(
    connection: ByteConnection,
    target: ConnectAddress,
    signal: AbortSignal,
  ): Promise<ByteConnection>;

  /** Optional negotiation capability; see {@link NegotiatingTlsUpgrader}. */
  readonly reportsNegotiatedProtocol?: boolean;

  upgradeNegotiated?(
    connection: ByteConnection,
    target: ConnectAddress,
    signal: AbortSignal,
  ): Promise<NegotiatedConnection>;
}

export interface PlatformPrimitives {
  readonly sockets: SocketConnector;
  readonly random: RandomSource;
  readonly scheduler: Scheduler;
  readonly urls: URLParser;
  readonly nativeLineEnding: "\n" | "\r\n";

  wallTimeMilliseconds(): number;
}
