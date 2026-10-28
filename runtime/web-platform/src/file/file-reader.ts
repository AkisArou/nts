import { trimASCIIWhitespace } from "../core/ascii.ts";
import { concatBytes, latin1, TextDecoder } from "../core/encoding.ts";
import { DOMException } from "../core/errors.ts";
import { Event, EventTarget, cancelEvent, dispatchTrustedEvent, setEventHandlerAttribute } from "../core/events.ts";
import type { EventHandlerSlot, EventListener } from "../core/events.ts";
import { ProgressEvent } from "../core/progress-event.ts";
import { coerceToDOMString, requireArguments } from "../core/webidl.ts";
import { parseMIMEType } from "../forms/mime.ts";
import { currentWebPlatformRuntime } from "../provider/environment.ts";
import type { WebPlatformRuntime } from "../provider/web-platform-runtime.ts";
import type { ReadableStreamDefaultReader } from "../streams/readable.ts";
import { Blob, getBlobSize, getBlobStream, getBlobType, isBlob } from "./blob.ts";

type ReadKind = "ArrayBuffer" | "BinaryString" | "Text";
type FileReaderEventType = "loadstart" | "progress" | "load" | "abort" | "error" | "loadend";

/** HTML EventHandler receives Event, including events dispatched by script. */
export type FileReaderEventHandler = (this: FileReader, event: Event) => unknown;
export type FileReaderEventHandlerValue = FileReaderEventHandler | object | null;

class ReaderHandlerSlot implements EventHandlerSlot<FileReader, Event> {
  value: object | null = null;
  callback: FileReaderEventHandler | null = null;
  listener: EventListener | null = null;
}

class ReadOperation {
  readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly runtime: WebPlatformRuntime;
  readonly blob: Blob;
  readonly kind: ReadKind;
  readonly encodingLabel: string | undefined;
  readonly total: number;
  readonly chunks: Uint8Array[] = [];
  loaded = 0;
  lastProgressLoaded = 0;
  lastProgressTime: number;

  constructor(blob: Blob, kind: ReadKind, encodingLabel: string | undefined, runtime: WebPlatformRuntime) {
    this.reader = getBlobStream(blob).getReader();
    this.runtime = runtime;
    this.blob = blob;
    this.kind = kind;
    this.encodingLabel = encodingLabel;
    this.total = getBlobSize(blob);
    this.lastProgressTime = runtime.monotonicMilliseconds();
  }
}

// These are label-recognition policy only, not codec tables. Keep valid legacy
// labels distinct from invalid labels, which File API permits to fall back.
// https://github.com/whatwg/encoding/blob/02b303619962bd0fce3651c460117f67cd8c2cd4/encodings.json
const unavailableEncodingLabels = /^(?:866|ansi_x3\.4\-1968|arabic|ascii|asmo\-708|big5|big5\-hkscs|chinese|cn\-big5|cp1250|cp1251|cp1252|cp1253|cp1254|cp1255|cp1256|cp1257|cp1258|cp819|cp866|csbig5|cseuckr|cseucpkdfmtjapanese|csgb2312|csibm866|csiso2022jp|csiso2022kr|csiso58gb231280|csiso88596e|csiso88596i|csiso88598e|csiso88598i|csisolatin1|csisolatin2|csisolatin3|csisolatin4|csisolatin5|csisolatin6|csisolatin9|csisolatinarabic|csisolatincyrillic|csisolatingreek|csisolatinhebrew|cskoi8r|csksc56011987|csmacintosh|csshiftjis|cyrillic|dos\-874|ecma\-114|ecma\-118|elot_928|euc\-jp|euc\-kr|gb18030|gb2312|gb_2312|gb_2312\-80|gbk|greek|greek8|hebrew|hz\-gb\-2312|ibm819|ibm866|iso\-2022\-cn|iso\-2022\-cn\-ext|iso\-2022\-jp|iso\-2022\-kr|iso\-8859\-1|iso\-8859\-10|iso\-8859\-11|iso\-8859\-13|iso\-8859\-14|iso\-8859\-15|iso\-8859\-16|iso\-8859\-2|iso\-8859\-3|iso\-8859\-4|iso\-8859\-5|iso\-8859\-6|iso\-8859\-6\-e|iso\-8859\-6\-i|iso\-8859\-7|iso\-8859\-8|iso\-8859\-8\-e|iso\-8859\-8\-i|iso\-8859\-9|iso\-ir\-100|iso\-ir\-101|iso\-ir\-109|iso\-ir\-110|iso\-ir\-126|iso\-ir\-127|iso\-ir\-138|iso\-ir\-144|iso\-ir\-148|iso\-ir\-149|iso\-ir\-157|iso\-ir\-58|iso8859\-1|iso8859\-10|iso8859\-11|iso8859\-13|iso8859\-14|iso8859\-15|iso8859\-2|iso8859\-3|iso8859\-4|iso8859\-5|iso8859\-6|iso8859\-7|iso8859\-8|iso8859\-9|iso88591|iso885910|iso885911|iso885913|iso885914|iso885915|iso88592|iso88593|iso88594|iso88595|iso88596|iso88597|iso88598|iso88599|iso_8859\-1|iso_8859\-15|iso_8859\-1:1987|iso_8859\-2|iso_8859\-2:1987|iso_8859\-3|iso_8859\-3:1988|iso_8859\-4|iso_8859\-4:1988|iso_8859\-5|iso_8859\-5:1988|iso_8859\-6|iso_8859\-6:1987|iso_8859\-7|iso_8859\-7:1987|iso_8859\-8|iso_8859\-8:1988|iso_8859\-9|iso_8859\-9:1989|koi|koi8|koi8\-r|koi8\-ru|koi8\-u|koi8_r|korean|ks_c_5601\-1987|ks_c_5601\-1989|ksc5601|ksc_5601|l1|l2|l3|l4|l5|l6|l9|latin1|latin2|latin3|latin4|latin5|latin6|logical|mac|macintosh|ms932|ms_kanji|replacement|shift\-jis|shift_jis|sjis|sun_eu_greek|tis\-620|us\-ascii|visual|windows\-1250|windows\-1251|windows\-1252|windows\-1253|windows\-1254|windows\-1255|windows\-1256|windows\-1257|windows\-1258|windows\-31j|windows\-874|windows\-949|x\-cp1250|x\-cp1251|x\-cp1252|x\-cp1253|x\-cp1254|x\-cp1255|x\-cp1256|x\-cp1257|x\-cp1258|x\-euc\-jp|x\-gbk|x\-mac\-cyrillic|x\-mac\-roman|x\-mac\-ukrainian|x\-sjis|x\-user\-defined|x\-x\-big5)$/i;

function decoderForLabel(label: string): TextDecoder | null {
  try {
    return new TextDecoder(label);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    if (unavailableEncodingLabels.test(trimASCIIWhitespace(label))) {
      // A valid label must not silently fall back to a different codec. This
      // explicit capability limitation goes away when canonical TextDecoder
      // supplies that encoding; it is not a File API decoding result.
      throw new DOMException("The provider does not support this text encoding", "NotSupportedError");
    }
    return null;
  }
}

function decodeFileText(bytes: Uint8Array, mimeType: string, encodingLabel: string | undefined): string {
  // Encoding's decode algorithm lets a UTF BOM override the fallback encoding.
  // The canonical decoder consumes the BOM; no conversion is implemented here.
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes);
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  let decoder = encodingLabel === undefined ? null : decoderForLabel(encodingLabel);
  if (decoder === null) {
    const charset = parseMIMEType(mimeType)?.parameters.get("charset");
    if (charset !== undefined) decoder = decoderForLabel(charset);
  }
  return (decoder ?? new TextDecoder()).decode(bytes);
}

function requireBlob(value: unknown): Blob {
  if (!isBlob(value)) throw new TypeError("FileReader requires a Blob");
  return value;
}

function readError(error: unknown): DOMException {
  return error instanceof DOMException ? error : new DOMException("The blob could not be read", "NotReadableError");
}

async function cancelRead(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Cancellation cleanup cannot turn abort into a later read-error event.
  } finally {
    reader.releaseLock();
  }
}

// Typed nts programs cannot replace Function.prototype.call or attach an own
// call property to a function. Handler callbacks keep their receiver directly.
let invokeHandler!: (reader: FileReader, index: number, event: Event) => void;

function isReaderEvent(_event: Event): _event is Event { return true; }

function onLoadstart(this: FileReader, event: Event): void { invokeHandler(this, 0, event); }
function onProgress(this: FileReader, event: Event): void { invokeHandler(this, 1, event); }
function onLoad(this: FileReader, event: Event): void { invokeHandler(this, 2, event); }
function onAbort(this: FileReader, event: Event): void { invokeHandler(this, 3, event); }
function onError(this: FileReader, event: Event): void { invokeHandler(this, 4, event); }
function onLoadend(this: FileReader, event: Event): void { invokeHandler(this, 5, event); }

/**
 * File API §6.2: asynchronous reads over canonical immutable Blob storage.
 *
 * readAsDataURL is deliberately absent until the provider exposes a base64
 * encoder. Recognized legacy text encodings likewise require codec support.
 */
export class FileReader extends EventTarget {
  static readonly EMPTY = 0;
  static readonly LOADING = 1;
  static readonly DONE = 2;
  readonly EMPTY = 0;
  readonly LOADING = 1;
  readonly DONE = 2;
  readonly [Symbol.toStringTag] = "FileReader";

  #state = 0;
  #result: string | ArrayBuffer | null = null;
  #error: DOMException | null = null;
  #operation: ReadOperation | null = null;
  readonly #handlers: readonly ReaderHandlerSlot[] = [
    new ReaderHandlerSlot(), new ReaderHandlerSlot(), new ReaderHandlerSlot(),
    new ReaderHandlerSlot(), new ReaderHandlerSlot(), new ReaderHandlerSlot(),
  ];

  static {
    invokeHandler = (reader, index, event): void => {
      const callback = reader.#handlers[index]?.value;
      // LegacyTreatNonObjectAsNull retains non-callable objects, whose invocation
      // is a no-op. Keep the FileReader receiver on the callback call.
      if (typeof callback === "function" && (callback as FileReaderEventHandler).call(reader, event) === false) {
        cancelEvent(event);
      }
    };
  }

  get readyState(): number { return this.#state; }
  get result(): string | ArrayBuffer | null { return this.#result; }
  get error(): DOMException | null { return this.#error; }

  get onloadstart(): FileReaderEventHandlerValue { return this.#handlerValue(0); }
  set onloadstart(value: FileReaderEventHandlerValue) { this.#setHandler(0, "loadstart", value, onLoadstart); }
  get onprogress(): FileReaderEventHandlerValue { return this.#handlerValue(1); }
  set onprogress(value: FileReaderEventHandlerValue) { this.#setHandler(1, "progress", value, onProgress); }
  get onload(): FileReaderEventHandlerValue { return this.#handlerValue(2); }
  set onload(value: FileReaderEventHandlerValue) { this.#setHandler(2, "load", value, onLoad); }
  get onabort(): FileReaderEventHandlerValue { return this.#handlerValue(3); }
  set onabort(value: FileReaderEventHandlerValue) { this.#setHandler(3, "abort", value, onAbort); }
  get onerror(): FileReaderEventHandlerValue { return this.#handlerValue(4); }
  set onerror(value: FileReaderEventHandlerValue) { this.#setHandler(4, "error", value, onError); }
  get onloadend(): FileReaderEventHandlerValue { return this.#handlerValue(5); }
  set onloadend(value: FileReaderEventHandlerValue) { this.#setHandler(5, "loadend", value, onLoadend); }

  #handlerValue(index: number): FileReaderEventHandlerValue {
    return this.#handlers[index]?.value ?? null;
  }

  #setHandler(index: number, type: FileReaderEventType, value: unknown, callback: FileReaderEventHandler): void {
    const slot = this.#handlers[index];
    if (slot === undefined) throw new Error("FileReader handler slot is missing");
    slot.value = value !== null && (typeof value === "object" || typeof value === "function") ? value : null;
    setEventHandlerAttribute(this, slot, type, slot.value === null ? null : callback, isReaderEvent);
  }

  readAsArrayBuffer(blob: Blob): void {
    if (!(#state in this)) throw new TypeError("FileReader method called on an incompatible receiver");
    requireArguments(arguments, 1, "FileReader.readAsArrayBuffer");
    this.#read(requireBlob(blob), "ArrayBuffer", undefined);
  }

  readAsBinaryString(blob: Blob): void {
    if (!(#state in this)) throw new TypeError("FileReader method called on an incompatible receiver");
    requireArguments(arguments, 1, "FileReader.readAsBinaryString");
    this.#read(requireBlob(blob), "BinaryString", undefined);
  }

  readAsText(blob: Blob, encoding: string | undefined = undefined): void {
    if (!(#state in this)) throw new TypeError("FileReader method called on an incompatible receiver");
    requireArguments(arguments, 1, "FileReader.readAsText");
    const convertedBlob = requireBlob(blob);
    const label = encoding === undefined ? undefined : coerceToDOMString(encoding);
    this.#read(convertedBlob, "Text", label);
  }

  #read(blob: Blob, kind: ReadKind, encodingLabel: string | undefined): void {
    if (this.#state === 1) throw new DOMException("A read is already in progress", "InvalidStateError");
    const runtime = currentWebPlatformRuntime();
    this.#state = 1;
    this.#result = null;
    this.#error = null;
    const operation = new ReadOperation(blob, kind, encodingLabel, runtime);
    this.#operation = operation;
    void this.#readChunks(operation);
  }

  async #readChunks(operation: ReadOperation): Promise<void> {
    let first = true;
    try {
      while (this.#operation === operation) {
        const chunk = await operation.reader.read();
        if (this.#operation !== operation) return;
        if (first) {
          first = false;
          this.#queueProgressEvent(operation, "loadstart", 0);
        }
        if (chunk.done) {
          // File API's progress invariant requires the final nonempty byte count,
          // including reads which complete before the roughly 50ms interval.
          if (operation.loaded > operation.lastProgressLoaded) {
            this.#queueProgressEvent(operation, "progress", operation.loaded);
          }
          operation.runtime.scheduler.enqueue(() => this.#finish(operation));
          return;
        }
        if (!(chunk.value instanceof Uint8Array)) throw new DOMException("Invalid Blob chunk", "NotReadableError");
        operation.chunks.push(chunk.value);
        operation.loaded += chunk.value.byteLength;
        const now = operation.runtime.monotonicMilliseconds();
        if (now - operation.lastProgressTime >= 50) {
          operation.lastProgressTime = now;
          operation.lastProgressLoaded = operation.loaded;
          this.#queueProgressEvent(operation, "progress", operation.loaded);
        }
      }
    } catch (error) {
      if (this.#operation === operation) {
        operation.runtime.scheduler.enqueue(() => this.#finish(operation, readError(error)));
      }
    }
  }

  #queueProgressEvent(operation: ReadOperation, type: FileReaderEventType, loaded: number): void {
    operation.runtime.scheduler.enqueue(() => {
      if (this.#operation === operation) this.#fire(type, loaded, operation.total);
    });
  }

  #finish(operation: ReadOperation, failure: DOMException | null = null): void {
    if (this.#operation !== operation) return;
    this.#operation = null;
    this.#state = 2;
    this.#error = failure;
    if (failure === null) {
      try {
        const bytes = concatBytes(operation.chunks, operation.loaded);
        switch (operation.kind) {
          case "ArrayBuffer": this.#result = bytes.buffer; break;
          case "BinaryString": this.#result = latin1(bytes); break;
          case "Text": this.#result = decodeFileText(bytes, getBlobType(operation.blob), operation.encodingLabel); break;
        }
      } catch (error) {
        this.#error = readError(error);
      }
    }
    operation.chunks.length = 0;
    operation.reader.releaseLock();
    this.#fire(this.#error === null ? "load" : "error", operation.loaded, operation.total);
    // A load/error handler can start another read. Its loadend belongs to that
    // new operation; the completed operation must not emit one while loading.
    if (this.#state !== 1) this.#fire("loadend", operation.loaded, operation.total);
  }

  abort(): void {
    this.#result = null;
    if (this.#state !== 1) return;
    const operation = this.#operation;
    this.#operation = null;
    this.#state = 2;
    if (operation === null) return;
    operation.chunks.length = 0;
    void cancelRead(operation.reader);
    // Retiring the operation also retires every queued task and pending read
    // continuation. The events below are synchronous, as abort() specifies.
    this.#fire("abort", operation.loaded, operation.total);
    if (this.#state !== 1) this.#fire("loadend", operation.loaded, operation.total);
  }

  #fire(type: FileReaderEventType, loaded: number, total: number): void {
    dispatchTrustedEvent(this, new ProgressEvent(type, { lengthComputable: total !== 0, loaded, total }));
  }
}
