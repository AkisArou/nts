import { DOMException } from "../core/errors.ts";
import { EventTarget } from "../core/events.ts";
import { coerceToDOMString, requireArguments, requireDictionary } from "../core/webidl.ts";
import { currentWebPlatformRuntime } from "../provider/environment.ts";
import type { PerformanceCapabilities, PerformanceDetailCloner } from "../provider/performance.ts";
import type { WebPlatformRuntime } from "../provider/web-platform-runtime.ts";

export interface PerformanceMarkOptions {
  detail?: unknown;
  startTime?: number;
}

export interface PerformanceMeasureOptions {
  detail?: unknown;
  duration?: number;
  end?: string | number;
  start?: string | number;
}

export interface PerformanceEntryJSON {
  name: string;
  entryType: string;
  startTime: number;
  duration: number;
}

export interface PerformanceUserTimingJSON extends PerformanceEntryJSON {
  detail: unknown;
}

export interface PerformanceJSON {
  timeOrigin: number;
}

class EntryConstruction {
  readonly name: string;
  readonly type: "mark" | "measure";
  readonly start: number;
  readonly duration: number;
  readonly detail: unknown;

  constructor(name: string, type: "mark" | "measure", start: number, duration: number, detail: unknown) {
    this.name = name;
    this.type = type;
    this.start = start;
    this.duration = duration;
    this.detail = detail;
  }
}

class PerformanceConstruction {
  readonly runtime: WebPlatformRuntime;
  readonly capabilities: PerformanceCapabilities;

  constructor(runtime: WebPlatformRuntime, capabilities: PerformanceCapabilities) {
    this.runtime = runtime;
    this.capabilities = capabilities;
  }
}

class ConvertedMarkOptions {
  detail: unknown = null;
  start: number | undefined = undefined;
}

class ConvertedMeasureOptions {
  detail: unknown = undefined;
  duration: number | undefined = undefined;
  end: string | number | undefined = undefined;
  start: string | number | undefined = undefined;
}

function finiteDouble(value: number): number {
  const number = +value;
  if (!Number.isFinite(number)) throw new TypeError("Performance timestamp must be finite");
  return number;
}

function markOrTimestamp(value: string | number): string | number {
  // Web IDL's union chooses double only for a Number; other values use DOMString.
  return typeof value === "number" ? finiteDouble(value) : coerceToDOMString(value);
}

function convertMarkOptions(value: PerformanceMarkOptions | null | undefined): ConvertedMarkOptions {
  requireDictionary(value, "PerformanceMark options");
  const result = new ConvertedMarkOptions();
  if (value !== undefined && value !== null) {
    // Dictionary members are read and converted once, in lexical order.
    const detail = value.detail;
    result.detail = detail === undefined ? null : detail;
    const start = value.startTime;
    if (start !== undefined) result.start = finiteDouble(start);
  }
  return result;
}

function convertMeasureOptions(
  value: string | PerformanceMeasureOptions | null | undefined,
): string | ConvertedMeasureOptions {
  if (value !== undefined && value !== null && typeof value !== "object" && typeof value !== "function") {
    return coerceToDOMString(value);
  }
  const result = new ConvertedMeasureOptions();
  if (value !== undefined && value !== null) {
    const options = value as PerformanceMeasureOptions;
    result.detail = options.detail;
    const duration = options.duration;
    if (duration !== undefined) result.duration = finiteDouble(duration);
    const end = options.end;
    if (end !== undefined) result.end = markOrTimestamp(end);
    const start = options.start;
    if (start !== undefined) result.start = markOrTimestamp(start);
  }
  return result;
}

function cloneDetail(value: unknown, cloner: PerformanceDetailCloner | undefined): unknown {
  // Primitive serialization carries the same value and cannot inspect storage.
  if (value === null || (typeof value !== "object" && typeof value !== "function" && typeof value !== "symbol")) {
    return value;
  }
  if (typeof value === "function" || typeof value === "symbol") {
    throw new DOMException("Performance detail cannot be cloned", "DataCloneError");
  }
  if (cloner === undefined) {
    throw new DOMException("Performance object detail requires a structured-clone capability", "NotSupportedError");
  }
  const result = cloner.clone(value);
  if (!result.ok) throw result.error;
  return result.value;
}

const navigationTimingNames = new Set([
  "navigationStart", "unloadEventStart", "unloadEventEnd", "redirectStart", "redirectEnd",
  "fetchStart", "domainLookupStart", "domainLookupEnd", "connectStart", "connectEnd",
  "secureConnectionStart", "requestStart", "responseStart", "responseEnd", "domLoading",
  "domInteractive", "domContentLoadedEventStart", "domContentLoadedEventEnd", "domComplete",
  "loadEventStart", "loadEventEnd",
]);

let entryData!: (entry: PerformanceEntry) => EntryConstruction;
let markData!: (performance: Performance, name: string, options: ConvertedMarkOptions) => EntryConstruction;
const performances = new WeakMap<WebPlatformRuntime, Performance>();

function currentPerformance(): Performance {
  const runtime = currentWebPlatformRuntime();
  const performance = performances.get(runtime);
  if (performance === undefined) {
    throw new DOMException("Performance requires provider bootstrap initialization", "NotSupportedError");
  }
  return performance;
}

/** Performance Timeline's immutable common entry attributes. */
export class PerformanceEntry {
  readonly #data: EntryConstruction;

  static {
    entryData = (entry) => entry.#data;
  }

  constructor(data: EntryConstruction | undefined = undefined) {
    if (!(data instanceof EntryConstruction)) throw new TypeError("Illegal constructor");
    this.#data = data;
  }

  get name(): string { return this.#data.name; }
  get entryType(): string { return this.#data.type; }
  get startTime(): number { return this.#data.start; }
  get duration(): number { return this.#data.duration; }
  get [Symbol.toStringTag](): string { return "PerformanceEntry"; }

  toJSON(): PerformanceEntryJSON {
    const data = this.#data;
    return { name: data.name, entryType: data.type, startTime: data.start, duration: data.duration };
  }
}

/** User Timing §3.2.1. Direct construction does not add the mark to a timeline. */
export class PerformanceMark extends PerformanceEntry {
  readonly #detail: unknown;

  constructor(name: string, options?: PerformanceMarkOptions);
  /** @internal Converted construction used by the owning Performance object. */
  constructor(data: EntryConstruction);
  constructor(name: string | EntryConstruction, options: PerformanceMarkOptions = {}) {
    let data: EntryConstruction;
    if (name instanceof EntryConstruction) {
      data = name;
    } else {
      requireArguments(arguments, 1, "PerformanceMark constructor");
      const convertedName = coerceToDOMString(name);
      const convertedOptions = convertMarkOptions(options);
      // Use the same private creation algorithm without dispatching public now().
      data = markData(currentPerformance(), convertedName, convertedOptions);
    }
    super(data);
    this.#detail = data.detail;
  }

  get detail(): unknown { return this.#detail; }
  override get [Symbol.toStringTag](): string { return "PerformanceMark"; }
  override toJSON(): PerformanceUserTimingJSON { return { ...super.toJSON(), detail: this.#detail }; }
}

/** User Timing §3.3: measure() is the only public construction operation. */
export class PerformanceMeasure extends PerformanceEntry {
  readonly #detail: unknown;

  constructor(data: EntryConstruction | undefined = undefined) {
    if (!(data instanceof EntryConstruction)) throw new TypeError("Illegal constructor");
    super(data);
    this.#detail = data.detail;
  }

  get detail(): unknown { return this.#detail; }
  override get [Symbol.toStringTag](): string { return "PerformanceMeasure"; }
  override toJSON(): PerformanceUserTimingJSON { return { ...super.toJSON(), detail: this.#detail }; }
}

/** HR Time and User Timing for a non-Window environment. */
export class Performance extends EventTarget {
  readonly #monotonic: () => number;
  readonly #origin: number;
  readonly #epochOrigin: number | undefined;
  readonly #cloner: PerformanceDetailCloner | undefined;
  readonly #entries: PerformanceEntry[] = [];

  static {
    markData = (performance, name, options) => performance.#makeMarkData(name, options);
  }

  constructor(construction: PerformanceConstruction | undefined = undefined) {
    if (!(construction instanceof PerformanceConstruction)) throw new TypeError("Illegal constructor");
    super();
    const origin = construction.capabilities.timeOrigin;
    if (origin !== undefined && (!Number.isFinite(origin.epochMilliseconds) || !Number.isFinite(origin.monotonicMilliseconds))) {
      throw new TypeError("Performance time origin must contain finite clock values");
    }
    this.#monotonic = construction.runtime.monotonicMilliseconds.bind(construction.runtime);
    this.#origin = origin?.monotonicMilliseconds ?? 0;
    this.#epochOrigin = origin?.epochMilliseconds;
    this.#cloner = construction.capabilities.detailCloner;
  }

  // The hot path is one captured provider call and one constant subtraction.
  now(): number { return this.#monotonic() - this.#origin; }

  get timeOrigin(): number {
    if (this.#epochOrigin === undefined) {
      throw new DOMException("Performance timeOrigin requires a correlated environment origin", "NotSupportedError");
    }
    return this.#epochOrigin;
  }

  get [Symbol.toStringTag](): string { return "Performance"; }

  toJSON(): PerformanceJSON {
    // Use the intrinsic getter's state, rather than a replaceable public member.
    if (this.#epochOrigin === undefined) {
      throw new DOMException("Performance timeOrigin requires a correlated environment origin", "NotSupportedError");
    }
    return { timeOrigin: this.#epochOrigin };
  }

  mark(name: string, options: PerformanceMarkOptions = {}): PerformanceMark {
    if (!(#entries in this)) throw new TypeError("Performance method called on an incompatible receiver");
    requireArguments(arguments, 1, "Performance.mark");
    const convertedName = coerceToDOMString(name);
    const convertedOptions = convertMarkOptions(options);
    const mark = new PerformanceMark(this.#makeMarkData(convertedName, convertedOptions));
    this.#entries.push(mark);
    return mark;
  }

  #makeMarkData(name: string, options: ConvertedMarkOptions): EntryConstruction {
    if (options.start !== undefined && options.start < 0) throw new TypeError("Mark startTime must not be negative");
    const start = options.start ?? this.#monotonic() - this.#origin;
    const detail = cloneDetail(options.detail, this.#cloner);
    return new EntryConstruction(name, "mark", start, 0, detail);
  }

  clearMarks(name?: string): void {
    if (!(#entries in this)) throw new TypeError("Performance method called on an incompatible receiver");
    this.#clear("mark", name === undefined ? undefined : coerceToDOMString(name));
  }

  measure(
    name: string,
    startOrOptions: string | PerformanceMeasureOptions = {},
    endMark?: string,
  ): PerformanceMeasure {
    if (!(#entries in this)) throw new TypeError("Performance method called on an incompatible receiver");
    requireArguments(arguments, 1, "Performance.measure");
    const convertedName = coerceToDOMString(name);
    const options = convertMeasureOptions(startOrOptions);
    const convertedEnd = endMark === undefined ? undefined : coerceToDOMString(endMark);
    if (typeof options !== "string" && (options.start !== undefined || options.end !== undefined ||
        options.duration !== undefined || options.detail !== undefined)) {
      if (convertedEnd !== undefined) throw new TypeError("Measure options and an end mark cannot both be supplied");
      if (options.start === undefined && options.end === undefined) throw new TypeError("Measure options require start or end");
      if (options.start !== undefined && options.end !== undefined && options.duration !== undefined) {
        throw new TypeError("Measure options cannot supply start, end and duration together");
      }
    }

    let end: number;
    if (convertedEnd !== undefined) end = this.#timestamp(convertedEnd);
    else if (typeof options !== "string" && options.end !== undefined) end = this.#timestamp(options.end);
    else if (typeof options !== "string" && options.start !== undefined && options.duration !== undefined) {
      end = this.#timestamp(options.start) + this.#timestamp(options.duration);
    } else end = this.#monotonic() - this.#origin;

    let start: number;
    if (typeof options !== "string" && options.start !== undefined) start = this.#timestamp(options.start);
    else if (typeof options !== "string" && options.duration !== undefined && options.end !== undefined) {
      const duration = this.#timestamp(options.duration);
      start = this.#timestamp(options.end) - duration;
    } else if (typeof options === "string") start = this.#timestamp(options);
    else start = 0;
    const detail = typeof options !== "string" && options.detail !== undefined
      ? cloneDetail(options.detail, this.#cloner) : null;
    const entry = new PerformanceMeasure(new EntryConstruction(convertedName, "measure", start, end - start, detail));
    this.#entries.push(entry);
    return entry;
  }

  #timestamp(mark: string | number): number {
    if (typeof mark === "number") {
      if (mark < 0) throw new TypeError("Measure timestamp must not be negative");
      return mark;
    }
    if (navigationTimingNames.has(mark)) {
      throw new TypeError("Navigation timing names require a Window environment");
    }
    for (let index = this.#entries.length - 1; index >= 0; index--) {
      const entry = this.#entries[index]!;
      const data = entryData(entry);
      if (data.type === "mark" && data.name === mark) return data.start;
    }
    throw new DOMException("The requested performance mark does not exist", "SyntaxError");
  }

  clearMeasures(name?: string): void {
    if (!(#entries in this)) throw new TypeError("Performance method called on an incompatible receiver");
    this.#clear("measure", name === undefined ? undefined : coerceToDOMString(name));
  }

  #clear(type: string, name: string | undefined): void {
    let retained = 0;
    for (const entry of this.#entries) {
      const data = entryData(entry);
      if (data.type !== type || (name !== undefined && data.name !== name)) this.#entries[retained++] = entry;
    }
    this.#entries.length = retained;
  }

  getEntries(): PerformanceEntry[] { return this.#filter(undefined, undefined); }

  getEntriesByType(type: string): PerformanceEntry[] {
    if (!(#entries in this)) throw new TypeError("Performance method called on an incompatible receiver");
    requireArguments(arguments, 1, "Performance.getEntriesByType");
    return this.#filter(undefined, coerceToDOMString(type));
  }

  getEntriesByName(name: string, type?: string): PerformanceEntry[] {
    if (!(#entries in this)) throw new TypeError("Performance method called on an incompatible receiver");
    requireArguments(arguments, 1, "Performance.getEntriesByName");
    const convertedName = coerceToDOMString(name);
    const convertedType = type === undefined ? undefined : coerceToDOMString(type);
    return this.#filter(convertedName, convertedType);
  }

  #filter(name: string | undefined, type: string | undefined): PerformanceEntry[] {
    const result: PerformanceEntry[] = [];
    for (const entry of this.#entries) {
      const data = entryData(entry);
      if ((name === undefined || data.name === name) && (type === undefined || data.type === type)) result.push(entry);
    }
    return result.sort((left, right) => entryData(left).start - entryData(right).start);
  }
}

/** @internal Provider bootstrap installs one canonical Performance per runtime. */
export function createPerformance(runtime: WebPlatformRuntime, capabilities: PerformanceCapabilities = {}): Performance {
  if (performances.has(runtime)) throw new TypeError("Performance is already installed for this runtime");
  const performance = new Performance(new PerformanceConstruction(runtime, capabilities));
  performances.set(runtime, performance);
  return performance;
}
