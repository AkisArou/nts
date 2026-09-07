import { concatBytes } from "../core/encoding.ts";
import { LimitError, ProtocolError } from "../core/errors.ts";
import { BufferedReader } from "../http1/io.ts";

export const HTTP2_FRAME_DATA = 0;
export const HTTP2_FRAME_HEADERS = 1;
export const HTTP2_FRAME_PRIORITY = 2;
export const HTTP2_FRAME_RST_STREAM = 3;
export const HTTP2_FRAME_SETTINGS = 4;
export const HTTP2_FRAME_PUSH_PROMISE = 5;
export const HTTP2_FRAME_PING = 6;
export const HTTP2_FRAME_GOAWAY = 7;
export const HTTP2_FRAME_WINDOW_UPDATE = 8;
export const HTTP2_FRAME_CONTINUATION = 9;

export const HTTP2_FLAG_END_STREAM = 1;
export const HTTP2_FLAG_ACK = 1;
export const HTTP2_FLAG_END_HEADERS = 4;
export const HTTP2_FLAG_PADDED = 8;
export const HTTP2_FLAG_PRIORITY = 32;

export const HTTP2_NO_ERROR = 0;
export const HTTP2_PROTOCOL_ERROR = 1;
export const HTTP2_INTERNAL_ERROR = 2;
export const HTTP2_FLOW_CONTROL_ERROR = 3;
export const HTTP2_SETTINGS_TIMEOUT = 4;
export const HTTP2_STREAM_CLOSED = 5;
export const HTTP2_FRAME_SIZE_ERROR = 6;
export const HTTP2_REFUSED_STREAM = 7;
export const HTTP2_CANCEL = 8;
export const HTTP2_COMPRESSION_ERROR = 9;
export const HTTP2_CONNECT_ERROR = 10;
export const HTTP2_ENHANCE_YOUR_CALM = 11;
export const HTTP2_INADEQUATE_SECURITY = 12;
export const HTTP2_HTTP_1_1_REQUIRED = 13;

export const HTTP2_SETTING_HEADER_TABLE_SIZE = 1;
export const HTTP2_SETTING_ENABLE_PUSH = 2;
export const HTTP2_SETTING_MAX_CONCURRENT_STREAMS = 3;
export const HTTP2_SETTING_INITIAL_WINDOW_SIZE = 4;
export const HTTP2_SETTING_MAX_FRAME_SIZE = 5;
export const HTTP2_SETTING_MAX_HEADER_LIST_SIZE = 6;
export const HTTP2_SETTING_ENABLE_CONNECT_PROTOCOL = 8;

export const HTTP2_DEFAULT_FRAME_SIZE = 16384;
export const HTTP2_MAX_FRAME_SIZE = 0xffffff;
export const HTTP2_DEFAULT_WINDOW_SIZE = 65535;
export const HTTP2_MAX_WINDOW_SIZE = 0x7fffffff;

export interface Http2Frame {
  readonly type: number;
  readonly flags: number;
  readonly streamId: number;
  readonly payload: Uint8Array;
}

export interface Http2Setting {
  readonly identifier: number;
  readonly value: number;
}

export interface Http2Priority {
  readonly exclusive: boolean;
  readonly streamDependency: number;
  readonly weight: number;
}

export interface Http2DataPayload {
  readonly data: Uint8Array;
  readonly paddingBytes: number;
}

export interface Http2HeadersPayload {
  readonly fragment: Uint8Array;
  readonly paddingBytes: number;
  readonly priority: Http2Priority | null;
}

export interface Http2PushPromisePayload {
  readonly promisedStreamId: number;
  readonly fragment: Uint8Array;
  readonly paddingBytes: number;
}

export interface Http2GoAwayPayload {
  readonly lastStreamId: number;
  readonly errorCode: number;
  readonly debugData: Uint8Array;
}

export interface Http2HeaderBlock {
  readonly kind: "headers" | "push-promise";
  readonly streamId: number;
  readonly endStream: boolean;
  readonly promisedStreamId: number | null;
  readonly priority: Http2Priority | null;
  readonly block: Uint8Array;
}

/** An RFC 9113 connection error when streamId is null, otherwise a stream error. */
export class Http2WireError extends ProtocolError {
  readonly errorCode: number;
  readonly streamId: number | null;

  constructor(message: string, errorCode: number, streamId: number | null = null) {
    super(message);
    this.name = "Http2WireError";
    this.errorCode = errorCode;
    this.streamId = streamId;
  }
}

function requireByte(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError(name + " must be an unsigned byte");
  }
}

function requireStreamId(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > HTTP2_MAX_WINDOW_SIZE) {
    throw new RangeError("HTTP/2 stream identifier is outside the 31-bit range");
  }
}

function requireFrameLimit(value: number): void {
  if (
    !Number.isInteger(value) ||
    value < HTTP2_DEFAULT_FRAME_SIZE ||
    value > HTTP2_MAX_FRAME_SIZE
  ) {
    throw new RangeError("HTTP/2 maximum frame size is outside the permitted range");
  }
}

function readUint32(bytes: Uint8Array, offset: number): number {
  const a = bytes[offset];
  const b = bytes[offset + 1];
  const c = bytes[offset + 2];
  const d = bytes[offset + 3];
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    throw new Http2WireError("Truncated HTTP/2 integer", HTTP2_FRAME_SIZE_ERROR);
  }
  return a * 0x1000000 + b * 0x10000 + c * 0x100 + d;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = Math.floor(value / 0x1000000) & 255;
  bytes[offset + 1] = Math.floor(value / 0x10000) & 255;
  bytes[offset + 2] = Math.floor(value / 0x100) & 255;
  bytes[offset + 3] = value & 255;
}

function copyInto(output: Uint8Array, offset: number, input: Uint8Array): void {
  output.set(input, offset);
}

function frameSizeError(message: string): never {
  throw new Http2WireError(message, HTTP2_FRAME_SIZE_ERROR);
}

function protocolError(message: string): never {
  throw new Http2WireError(message, HTTP2_PROTOCOL_ERROR);
}

function requireConnectionFrame(frame: Http2Frame, name: string): void {
  if (frame.streamId !== 0) protocolError(name + " frame used a stream identifier");
}

function requireStreamFrame(frame: Http2Frame, name: string): void {
  if (frame.streamId === 0) protocolError(name + " frame used stream zero");
}

function requireLength(frame: Http2Frame, length: number, name: string): void {
  if (frame.payload.length !== length) frameSizeError(name + " frame has an invalid length");
}

function paddedRange(
  payload: Uint8Array,
  offset: number,
  padded: boolean,
): {
  readonly start: number;
  readonly end: number;
  readonly paddingBytes: number;
} {
  let start = offset;
  let paddingBytes = 0;
  if (padded) {
    const count = payload[0];
    if (count === undefined) frameSizeError("Padded HTTP/2 frame has no pad length");
    paddingBytes = count;
    start++;
  }
  const end = payload.length - paddingBytes;
  if (end < start) protocolError("HTTP/2 padding exceeds the frame payload");
  return { start, end, paddingBytes };
}

export function encodeHttp2Frame(
  frame: Http2Frame,
  maximumFrameSize = HTTP2_DEFAULT_FRAME_SIZE,
): Uint8Array {
  requireByte(frame.type, "HTTP/2 frame type");
  requireByte(frame.flags, "HTTP/2 frame flags");
  requireStreamId(frame.streamId);
  requireFrameLimit(maximumFrameSize);
  if (frame.payload.length > maximumFrameSize) {
    throw new LimitError("HTTP/2 frame exceeds the peer maximum frame size");
  }
  validateHttp2Frame(frame, maximumFrameSize);
  const output = new Uint8Array(9 + frame.payload.length);
  output[0] = Math.floor(frame.payload.length / 0x10000) & 255;
  output[1] = Math.floor(frame.payload.length / 0x100) & 255;
  output[2] = frame.payload.length & 255;
  output[3] = frame.type;
  output[4] = frame.flags;
  writeUint32(output, 5, frame.streamId);
  copyInto(output, 9, frame.payload);
  return output;
}

export function decodeHttp2Frame(
  bytes: Uint8Array,
  maximumFrameSize = HTTP2_DEFAULT_FRAME_SIZE,
): Http2Frame {
  requireFrameLimit(maximumFrameSize);
  if (bytes.length < 9) frameSizeError("Truncated HTTP/2 frame header");
  const length = (bytes[0] ?? 0) * 0x10000 + (bytes[1] ?? 0) * 0x100 + (bytes[2] ?? 0);
  if (length > maximumFrameSize) frameSizeError("HTTP/2 frame exceeds the local maximum size");
  if (bytes.length !== length + 9) frameSizeError("HTTP/2 frame length does not match its payload");
  const frame: Http2Frame = {
    type: bytes[3] ?? 0,
    flags: bytes[4] ?? 0,
    streamId: readUint32(bytes, 5) & HTTP2_MAX_WINDOW_SIZE,
    payload: bytes.subarray(9),
  };
  validateHttp2Frame(frame, maximumFrameSize);
  return frame;
}

export async function readHttp2Frame(
  reader: BufferedReader,
  maximumFrameSize = HTTP2_DEFAULT_FRAME_SIZE,
): Promise<Http2Frame> {
  requireFrameLimit(maximumFrameSize);
  const header = await reader.exact(9);
  const length = (header[0] ?? 0) * 0x10000 + (header[1] ?? 0) * 0x100 + (header[2] ?? 0);
  if (length > maximumFrameSize) frameSizeError("HTTP/2 frame exceeds the local maximum size");
  const payload = await reader.exact(length);
  const frame: Http2Frame = {
    type: header[3] ?? 0,
    flags: header[4] ?? 0,
    streamId: readUint32(header, 5) & HTTP2_MAX_WINDOW_SIZE,
    payload,
  };
  try {
    validateHttp2Frame(frame, maximumFrameSize);
  } catch (error) {
    // Stream errors need the connection's stream table so they can become an
    // RST_STREAM without killing unrelated streams.  The connection reparses
    // the affected payload after the frame has crossed this envelope layer.
    if (!(error instanceof Http2WireError) || error.streamId === null) throw error;
  }
  return frame;
}

export function parseHttp2Data(frame: Http2Frame): Http2DataPayload {
  requireStreamFrame(frame, "DATA");
  const range = paddedRange(frame.payload, 0, (frame.flags & HTTP2_FLAG_PADDED) !== 0);
  return {
    data: frame.payload.subarray(range.start, range.end),
    paddingBytes: range.paddingBytes,
  };
}

export function parseHttp2Priority(frame: Http2Frame): Http2Priority {
  requireStreamFrame(frame, "PRIORITY");
  requireLength(frame, 5, "PRIORITY");
  const priority = parsePriorityFields(frame.payload, 0);
  requireNonSelfDependency(priority, frame.streamId);
  return priority;
}

function parsePriorityFields(payload: Uint8Array, offset: number): Http2Priority {
  const rawDependency = readUint32(payload, offset);
  return {
    exclusive: rawDependency >= 0x80000000,
    streamDependency: rawDependency & HTTP2_MAX_WINDOW_SIZE,
    weight: (payload[offset + 4] ?? 0) + 1,
  };
}

function requireNonSelfDependency(priority: Http2Priority, ownStreamId: number): void {
  if (priority.streamDependency === ownStreamId) {
    throw new Http2WireError("HTTP/2 stream depends on itself", HTTP2_PROTOCOL_ERROR, ownStreamId);
  }
}

export function parseHttp2Headers(frame: Http2Frame): Http2HeadersPayload {
  requireStreamFrame(frame, "HEADERS");
  const range = paddedRange(frame.payload, 0, (frame.flags & HTTP2_FLAG_PADDED) !== 0);
  let start = range.start;
  let priority: Http2Priority | null = null;
  if ((frame.flags & HTTP2_FLAG_PRIORITY) !== 0) {
    if (range.end - start < 5) frameSizeError("HEADERS priority fields are truncated");
    priority = parsePriorityFields(frame.payload, start);
    start += 5;
  }
  return {
    fragment: frame.payload.subarray(start, range.end),
    paddingBytes: range.paddingBytes,
    priority,
  };
}

export function parseHttp2PushPromise(frame: Http2Frame): Http2PushPromisePayload {
  requireStreamFrame(frame, "PUSH_PROMISE");
  const range = paddedRange(frame.payload, 0, (frame.flags & HTTP2_FLAG_PADDED) !== 0);
  if (range.end - range.start < 4) frameSizeError("PUSH_PROMISE stream identifier is truncated");
  const promisedStreamId = readUint32(frame.payload, range.start) & HTTP2_MAX_WINDOW_SIZE;
  if (promisedStreamId === 0) protocolError("PUSH_PROMISE used promised stream zero");
  return {
    promisedStreamId,
    fragment: frame.payload.subarray(range.start + 4, range.end),
    paddingBytes: range.paddingBytes,
  };
}

export function parseHttp2Settings(frame: Http2Frame): Http2Setting[] {
  requireConnectionFrame(frame, "SETTINGS");
  if ((frame.flags & HTTP2_FLAG_ACK) !== 0 && frame.payload.length !== 0) {
    frameSizeError("Acknowledged SETTINGS frame has a payload");
  }
  if (frame.payload.length % 6 !== 0) frameSizeError("SETTINGS payload is not a sequence of pairs");
  const settings: Http2Setting[] = [];
  for (let offset = 0; offset < frame.payload.length; offset += 6) {
    const identifier = (frame.payload[offset] ?? 0) * 0x100 + (frame.payload[offset + 1] ?? 0);
    const value = readUint32(frame.payload, offset + 2);
    validateHttp2Setting(identifier, value);
    settings.push({ identifier, value });
  }
  return settings;
}

function validateHttp2Setting(identifier: number, value: number): void {
  if (
    (identifier === HTTP2_SETTING_ENABLE_PUSH ||
      identifier === HTTP2_SETTING_ENABLE_CONNECT_PROTOCOL) &&
    value !== 0 &&
    value !== 1
  ) {
    protocolError("HTTP/2 boolean setting is neither zero nor one");
  }
  if (identifier === HTTP2_SETTING_INITIAL_WINDOW_SIZE && value > HTTP2_MAX_WINDOW_SIZE) {
    throw new Http2WireError(
      "HTTP/2 initial window exceeds the signed 31-bit range",
      HTTP2_FLOW_CONTROL_ERROR,
    );
  }
  if (
    identifier === HTTP2_SETTING_MAX_FRAME_SIZE &&
    (value < HTTP2_DEFAULT_FRAME_SIZE || value > HTTP2_MAX_FRAME_SIZE)
  ) {
    protocolError("HTTP/2 maximum frame setting is outside the permitted range");
  }
}

export function parseHttp2WindowUpdate(frame: Http2Frame): number {
  requireLength(frame, 4, "WINDOW_UPDATE");
  const increment = readUint32(frame.payload, 0) & HTTP2_MAX_WINDOW_SIZE;
  if (increment === 0) {
    throw new Http2WireError(
      "HTTP/2 window increment is zero",
      HTTP2_PROTOCOL_ERROR,
      frame.streamId === 0 ? null : frame.streamId,
    );
  }
  return increment;
}

export function parseHttp2GoAway(frame: Http2Frame): Http2GoAwayPayload {
  requireConnectionFrame(frame, "GOAWAY");
  if (frame.payload.length < 8) frameSizeError("GOAWAY frame is truncated");
  return {
    lastStreamId: readUint32(frame.payload, 0) & HTTP2_MAX_WINDOW_SIZE,
    errorCode: readUint32(frame.payload, 4),
    debugData: frame.payload.subarray(8),
  };
}

export function parseHttp2RstStream(frame: Http2Frame): number {
  requireStreamFrame(frame, "RST_STREAM");
  requireLength(frame, 4, "RST_STREAM");
  return readUint32(frame.payload, 0);
}

export function validateHttp2Frame(
  frame: Http2Frame,
  maximumFrameSize = HTTP2_DEFAULT_FRAME_SIZE,
): void {
  requireByte(frame.type, "HTTP/2 frame type");
  requireByte(frame.flags, "HTTP/2 frame flags");
  requireStreamId(frame.streamId);
  requireFrameLimit(maximumFrameSize);
  if (frame.payload.length > maximumFrameSize) frameSizeError("HTTP/2 frame exceeds local limit");

  switch (frame.type) {
    case HTTP2_FRAME_DATA:
      parseHttp2Data(frame);
      return;
    case HTTP2_FRAME_HEADERS:
      {
        const headers = parseHttp2Headers(frame);
        if (headers.priority !== null) requireNonSelfDependency(headers.priority, frame.streamId);
      }
      return;
    case HTTP2_FRAME_PRIORITY:
      parseHttp2Priority(frame);
      return;
    case HTTP2_FRAME_RST_STREAM:
      parseHttp2RstStream(frame);
      return;
    case HTTP2_FRAME_SETTINGS:
      parseHttp2Settings(frame);
      return;
    case HTTP2_FRAME_PUSH_PROMISE:
      parseHttp2PushPromise(frame);
      return;
    case HTTP2_FRAME_PING:
      requireConnectionFrame(frame, "PING");
      requireLength(frame, 8, "PING");
      return;
    case HTTP2_FRAME_GOAWAY:
      parseHttp2GoAway(frame);
      return;
    case HTTP2_FRAME_WINDOW_UPDATE:
      parseHttp2WindowUpdate(frame);
      return;
    case HTTP2_FRAME_CONTINUATION:
      requireStreamFrame(frame, "CONTINUATION");
      return;
  }
}

export function encodeHttp2Settings(settings: readonly Http2Setting[]): Uint8Array {
  const payload = new Uint8Array(settings.length * 6);
  for (let index = 0; index < settings.length; index++) {
    const setting = settings[index];
    if (setting === undefined) continue;
    if (
      !Number.isInteger(setting.identifier) ||
      setting.identifier < 0 ||
      setting.identifier > 65535
    ) {
      throw new RangeError("HTTP/2 setting identifier is outside the 16-bit range");
    }
    if (!Number.isInteger(setting.value) || setting.value < 0 || setting.value > 0xffffffff) {
      throw new RangeError("HTTP/2 setting value is outside the 32-bit range");
    }
    validateHttp2Setting(setting.identifier, setting.value);
    const offset = index * 6;
    payload[offset] = Math.floor(setting.identifier / 0x100);
    payload[offset + 1] = setting.identifier & 255;
    writeUint32(payload, offset + 2, setting.value);
  }
  return payload;
}

export function encodeHttp2WindowUpdate(increment: number): Uint8Array {
  if (!Number.isInteger(increment) || increment < 1 || increment > HTTP2_MAX_WINDOW_SIZE) {
    throw new RangeError("HTTP/2 window increment is outside the signed 31-bit range");
  }
  const payload = new Uint8Array(4);
  writeUint32(payload, 0, increment);
  return payload;
}

export function encodeHttp2ErrorCode(errorCode: number): Uint8Array {
  if (!Number.isInteger(errorCode) || errorCode < 0 || errorCode > 0xffffffff) {
    throw new RangeError("HTTP/2 error code is outside the 32-bit range");
  }
  const payload = new Uint8Array(4);
  writeUint32(payload, 0, errorCode);
  return payload;
}

export function encodeHttp2GoAway(
  lastStreamId: number,
  errorCode: number,
  debugData: Uint8Array = new Uint8Array(0),
): Uint8Array {
  requireStreamId(lastStreamId);
  if (!Number.isInteger(errorCode) || errorCode < 0 || errorCode > 0xffffffff) {
    throw new RangeError("HTTP/2 error code is outside the 32-bit range");
  }
  const payload = new Uint8Array(8 + debugData.length);
  writeUint32(payload, 0, lastStreamId);
  writeUint32(payload, 4, errorCode);
  copyInto(payload, 8, debugData);
  return payload;
}

interface PendingHeaderBlock {
  readonly kind: "headers" | "push-promise";
  readonly streamId: number;
  readonly endStream: boolean;
  readonly promisedStreamId: number | null;
  readonly priority: Http2Priority | null;
  readonly fragments: Uint8Array[];
  bytes: number;
}

/** Enforces the connection-wide CONTINUATION sequencing rule and a compressed-byte limit. */
export class Http2HeaderBlockAssembler {
  private readonly maximumBytes: number;
  private readonly maximumFragments: number;
  private pending: PendingHeaderBlock | null = null;

  constructor(maximumBytes: number, maximumFragments = 1024) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
      throw new RangeError("Invalid compressed header-block limit");
    }
    if (!Number.isSafeInteger(maximumFragments) || maximumFragments < 1) {
      throw new RangeError("Invalid HTTP/2 header-block fragment limit");
    }
    this.maximumBytes = maximumBytes;
    this.maximumFragments = maximumFragments;
  }

  accept(frame: Http2Frame): Http2HeaderBlock | null {
    try {
      validateHttp2Frame(frame, HTTP2_MAX_FRAME_SIZE);
    } catch (error) {
      // A HEADERS self-dependency is a stream error, but its complete compressed
      // block still has to be consumed and decoded so the connection-wide HPACK
      // state remains synchronized.  Preserve it on the assembled result and
      // let the connection reset the stream after decoding.
      if (
        frame.type !== HTTP2_FRAME_HEADERS ||
        !(error instanceof Http2WireError) ||
        error.streamId === null
      ) {
        throw error;
      }
    }
    const pending = this.pending;
    if (pending !== null) {
      if (frame.type !== HTTP2_FRAME_CONTINUATION || frame.streamId !== pending.streamId) {
        protocolError("HTTP/2 header block was interrupted before END_HEADERS");
      }
      this.append(pending, frame.payload);
      if ((frame.flags & HTTP2_FLAG_END_HEADERS) === 0) return null;
      this.pending = null;
      return this.finish(pending);
    }

    if (frame.type === HTTP2_FRAME_CONTINUATION) {
      protocolError("Unexpected HTTP/2 CONTINUATION frame");
    }
    if (frame.type !== HTTP2_FRAME_HEADERS && frame.type !== HTTP2_FRAME_PUSH_PROMISE) return null;

    const isHeaders = frame.type === HTTP2_FRAME_HEADERS;
    const headers = isHeaders ? parseHttp2Headers(frame) : null;
    const push = isHeaders ? null : parseHttp2PushPromise(frame);
    const next: PendingHeaderBlock = {
      kind: isHeaders ? "headers" : "push-promise",
      streamId: frame.streamId,
      endStream: isHeaders && (frame.flags & HTTP2_FLAG_END_STREAM) !== 0,
      promisedStreamId: push?.promisedStreamId ?? null,
      priority: headers?.priority ?? null,
      fragments: [],
      bytes: 0,
    };
    this.append(next, headers?.fragment ?? push?.fragment ?? new Uint8Array(0));
    if ((frame.flags & HTTP2_FLAG_END_HEADERS) !== 0) return this.finish(next);
    this.pending = next;
    return null;
  }

  private append(pending: PendingHeaderBlock, fragment: Uint8Array): void {
    if (pending.fragments.length >= this.maximumFragments) {
      throw new LimitError("HTTP/2 header block has too many fragments");
    }
    if (fragment.length > this.maximumBytes - pending.bytes) {
      throw new LimitError("Compressed HTTP/2 header block exceeds configured limit");
    }
    pending.fragments.push(fragment);
    pending.bytes += fragment.length;
  }

  private finish(pending: PendingHeaderBlock): Http2HeaderBlock {
    return {
      kind: pending.kind,
      streamId: pending.streamId,
      endStream: pending.endStream,
      promisedStreamId: pending.promisedStreamId,
      priority: pending.priority,
      block: concatBytes(pending.fragments, pending.bytes),
    };
  }
}
