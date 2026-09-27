// Resource Timing: `PerformanceResourceTiming` and `markResourceTiming`, from
// node v24.20.0 `lib/internal/perf/resource_timing.js`.
//
// An entry per fetched resource, built from the fetch's timing record. The
// record belongs to the fetch implementation (undici's `timingInfo`, the Fetch
// standard's "fetch timing info"), and this reads it without validating it --
// the standard says the entry is set up from it as given, so a field the
// fetch never filled reads back as whatever it holds.

import {
  ERR_ILLEGAL_CONSTRUCTOR,
  ERR_INTERNAL_ASSERTION,
  ERR_INVALID_THIS,
} from "../../internal/errors.ts";
import { PerformanceEntry, kSkipThrow } from "./entry.ts";
import { bufferResourceTiming, enqueue } from "./observe.ts";

/** The connection half of a fetch timing record, absent for a reused connection. */
export interface ConnectionTimingInfo {
  domainLookupStartTime?: number;
  domainLookupEndTime?: number;
  connectionStartTime?: number;
  connectionEndTime?: number;
  secureConnectionStartTime?: number;
  ALPNNegotiatedProtocol?: unknown;
}

/** https://fetch.spec.whatwg.org/#fetch-timing-info, as undici fills it in. */
export interface FetchTimingInfo {
  startTime: number;
  redirectStartTime: number;
  redirectEndTime: number;
  postRedirectStartTime: number;
  finalServiceWorkerStartTime: number;
  finalNetworkRequestStartTime: number;
  finalNetworkResponseStartTime: number;
  endTime: number;
  encodedBodySize: number;
  decodedBodySize: number;
  finalConnectionTimingInfo?: ConnectionTimingInfo | null;
}

/** Everything `toJSON` reports, in node's order. */
export interface PerformanceResourceTimingJSON {
  name: string;
  entryType: string;
  startTime: number;
  duration: number;
  initiatorType: string;
  nextHopProtocol: unknown;
  workerStart: number;
  redirectStart: number;
  redirectEnd: number;
  fetchStart: number;
  domainLookupStart: number | undefined;
  domainLookupEnd: number | undefined;
  connectStart: number | undefined;
  connectEnd: number | undefined;
  secureConnectionStart: number | undefined;
  requestStart: number;
  responseStart: number;
  responseEnd: number;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
  deliveryType: string;
  responseStatus: number;
}

export class PerformanceResourceTiming extends PerformanceEntry {
  readonly #requestedUrl: string;
  readonly #timingInfo: FetchTimingInfo;
  readonly #initiatorType: string;
  readonly #cacheMode: string;
  readonly #deliveryType: string;
  readonly #responseStatus: number;

  constructor(
    skipThrow: unknown = undefined,
    requestedUrl = "",
    initiatorType = "",
    timingInfo?: FetchTimingInfo,
    cacheMode = "",
    responseStatus = 0,
    deliveryType = "",
  ) {
    if (skipThrow !== kSkipThrow || timingInfo === undefined) throw new ERR_ILLEGAL_CONSTRUCTOR();
    super(skipThrow, requestedUrl, "resource");
    this.#requestedUrl = requestedUrl;
    this.#initiatorType = initiatorType;
    this.#timingInfo = timingInfo;
    this.#cacheMode = cacheMode;
    this.#deliveryType = deliveryType;
    this.#responseStatus = responseStatus;
  }

  /** The timing record of a resource entry, or `ERR_INVALID_THIS` for anything else. */
  static #timing(value: unknown): FetchTimingInfo {
    if (value === null || typeof value !== "object" || !(#timingInfo in value)) {
      throw new ERR_INVALID_THIS("PerformanceResourceTiming");
    }
    return value.#timingInfo;
  }

  static #self(value: unknown): PerformanceResourceTiming {
    if (value === null || typeof value !== "object" || !(#timingInfo in value)) {
      throw new ERR_INVALID_THIS("PerformanceResourceTiming");
    }
    return value;
  }

  override get name(): string {
    return PerformanceResourceTiming.#self(this).#requestedUrl;
  }

  override get startTime(): number {
    return PerformanceResourceTiming.#timing(this).startTime;
  }

  override get duration(): number {
    const timing = PerformanceResourceTiming.#timing(this);
    return timing.endTime - timing.startTime;
  }

  get initiatorType(): string {
    return PerformanceResourceTiming.#self(this).#initiatorType;
  }

  get workerStart(): number {
    return PerformanceResourceTiming.#timing(this).finalServiceWorkerStartTime;
  }

  get redirectStart(): number {
    return PerformanceResourceTiming.#timing(this).redirectStartTime;
  }

  get redirectEnd(): number {
    return PerformanceResourceTiming.#timing(this).redirectEndTime;
  }

  get fetchStart(): number {
    return PerformanceResourceTiming.#timing(this).postRedirectStartTime;
  }

  get domainLookupStart(): number | undefined {
    return PerformanceResourceTiming.#timing(this).finalConnectionTimingInfo?.domainLookupStartTime;
  }

  get domainLookupEnd(): number | undefined {
    return PerformanceResourceTiming.#timing(this).finalConnectionTimingInfo?.domainLookupEndTime;
  }

  get connectStart(): number | undefined {
    return PerformanceResourceTiming.#timing(this).finalConnectionTimingInfo?.connectionStartTime;
  }

  get connectEnd(): number | undefined {
    return PerformanceResourceTiming.#timing(this).finalConnectionTimingInfo?.connectionEndTime;
  }

  get secureConnectionStart(): number | undefined {
    return PerformanceResourceTiming.#timing(this).finalConnectionTimingInfo
      ?.secureConnectionStartTime;
  }

  get nextHopProtocol(): unknown {
    return PerformanceResourceTiming.#timing(this).finalConnectionTimingInfo
      ?.ALPNNegotiatedProtocol;
  }

  get requestStart(): number {
    return PerformanceResourceTiming.#timing(this).finalNetworkRequestStartTime;
  }

  get responseStart(): number {
    return PerformanceResourceTiming.#timing(this).finalNetworkResponseStartTime;
  }

  get responseEnd(): number {
    return PerformanceResourceTiming.#timing(this).endTime;
  }

  get encodedBodySize(): number {
    return PerformanceResourceTiming.#timing(this).encodedBodySize;
  }

  get decodedBodySize(): number {
    return PerformanceResourceTiming.#timing(this).decodedBodySize;
  }

  /**
   * The body plus a nominal 300 bytes of headers, as the standard has it --
   * nothing for a resource served from the local cache, and only the headers
   * for one the cache revalidated.
   */
  get transferSize(): number {
    const self = PerformanceResourceTiming.#self(this);
    if (self.#cacheMode === "local") return 0;
    if (self.#cacheMode === "validated") return 300;
    return self.#timingInfo.encodedBodySize + 300;
  }

  get deliveryType(): string {
    return PerformanceResourceTiming.#self(this).#deliveryType;
  }

  get responseStatus(): number {
    return PerformanceResourceTiming.#self(this).#responseStatus;
  }

  override toJSON(): PerformanceResourceTimingJSON {
    PerformanceResourceTiming.#self(this);
    return {
      name: this.name,
      entryType: this.entryType,
      startTime: this.startTime,
      duration: this.duration,
      initiatorType: this.#initiatorType,
      nextHopProtocol: this.nextHopProtocol,
      workerStart: this.workerStart,
      redirectStart: this.redirectStart,
      redirectEnd: this.redirectEnd,
      fetchStart: this.fetchStart,
      domainLookupStart: this.domainLookupStart,
      domainLookupEnd: this.domainLookupEnd,
      connectStart: this.connectStart,
      connectEnd: this.connectEnd,
      secureConnectionStart: this.secureConnectionStart,
      requestStart: this.requestStart,
      responseStart: this.responseStart,
      responseEnd: this.responseEnd,
      transferSize: this.transferSize,
      encodedBodySize: this.encodedBodySize,
      decodedBodySize: this.decodedBodySize,
      deliveryType: this.deliveryType,
      responseStatus: this.responseStatus,
    };
  }
}

/**
 * https://w3c.github.io/resource-timing/#dfn-mark-resource-timing
 *
 * `global` and `bodyInfo` are in the signature because the standard's
 * algorithm takes them and undici passes them; node reads neither, and
 * neither does this.
 */
export function markResourceTiming(
  timingInfo: FetchTimingInfo,
  requestedUrl: string,
  initiatorType: string,
  _global: unknown,
  cacheMode: string,
  _bodyInfo: unknown,
  responseStatus: number,
  deliveryType = "",
): PerformanceResourceTiming {
  if (cacheMode !== "" && cacheMode !== "local") {
    throw new ERR_INTERNAL_ASSERTION("cache must be an empty string or 'local'");
  }
  const resource = new PerformanceResourceTiming(
    kSkipThrow,
    requestedUrl,
    initiatorType,
    timingInfo,
    cacheMode,
    responseStatus,
    deliveryType,
  );
  enqueue(resource);
  bufferResourceTiming(resource);
  return resource;
}
