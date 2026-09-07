import { concatBytes } from "../core/encoding.ts";
import { LimitError, ProtocolError } from "../core/errors.ts";
import { isToken } from "../fetch/headers.ts";
import type { WebSocketDeflateContext, WebSocketDeflateProvider } from "./transport.ts";

const tail = Uint8Array.of(0, 0, 255, 255);

export interface PerMessageDeflateNegotiation {
  readonly response: string;
  readonly incomingNoContextTakeover: boolean;
  readonly outgoingNoContextTakeover: boolean;
  readonly incomingWindowBits: number;
  readonly outgoingWindowBits: number;
}

interface ExtensionParameter {
  readonly name: string;
  readonly value: string | null;
}

interface Extension {
  readonly name: string;
  readonly parameters: readonly ExtensionParameter[];
}

/** This client offers the RFC's unconstrained 32-KiB-window configuration. */
export const perMessageDeflateOffer = "permessage-deflate";

/** Validate the server's response to the exact offer above. */
export function negotiatePerMessageDeflate(
  header: string | null,
  offered: boolean,
): PerMessageDeflateNegotiation | null {
  if (header === null) return null;
  if (!offered) throw new ProtocolError("Unsolicited WebSocket extension");

  const extensions = parseExtensions(header);
  if (extensions.length !== 1 || extensions[0]?.name !== "permessage-deflate") {
    throw new ProtocolError("Server selected an extension that was not offered");
  }

  let incomingNoContextTakeover = false;
  let outgoingNoContextTakeover = false;
  let incomingWindowBits = 15;
  const seen = new Set<string>();
  for (const parameter of extensions[0].parameters) {
    if (seen.has(parameter.name)) {
      throw new ProtocolError("Duplicate permessage-deflate parameter");
    }
    seen.add(parameter.name);
    switch (parameter.name) {
      case "server_no_context_takeover":
        requireValueless(parameter);
        incomingNoContextTakeover = true;
        break;
      case "client_no_context_takeover":
        requireValueless(parameter);
        outgoingNoContextTakeover = true;
        break;
      case "server_max_window_bits":
        incomingWindowBits = parseWindowBits(parameter.value);
        break;
      case "client_max_window_bits":
        // The server may use this response parameter only when the client
        // included it in its offer. Our fixed offer deliberately does not.
        throw new ProtocolError("Unsolicited client_max_window_bits parameter");
      default:
        throw new ProtocolError("Unknown permessage-deflate parameter");
    }
  }

  return {
    response: header,
    incomingNoContextTakeover,
    outgoingNoContextTakeover,
    incomingWindowBits,
    outgoingWindowBits: 15,
  };
}

export class PerMessageDeflate {
  readonly response: string;
  private readonly inflater: WebSocketDeflateContext;
  private readonly deflater: WebSocketDeflateContext;
  private readonly negotiation: PerMessageDeflateNegotiation;
  private closed = false;

  constructor(provider: WebSocketDeflateProvider, negotiation: PerMessageDeflateNegotiation) {
    this.response = negotiation.response;
    this.negotiation = negotiation;
    this.inflater = provider.createInflater(negotiation.incomingWindowBits);
    try {
      this.deflater = provider.createDeflater(negotiation.outgoingWindowBits);
    } catch (error) {
      this.inflater.close();
      throw error;
    }
  }

  async compress(message: Uint8Array, maxOutputBytes: number): Promise<Uint8Array> {
    this.requireOpen();
    const flushLimit = Math.min(Number.MAX_SAFE_INTEGER, maxOutputBytes + tail.length);
    const output = await this.deflater.process(message, flushLimit);
    if (!hasTail(output)) throw new ProtocolError("Raw DEFLATE flush omitted its empty block");
    const compressed = output.slice(0, output.length - tail.length);
    if (compressed.length > maxOutputBytes) {
      throw new LimitError("Compressed WebSocket message exceeds configured limit");
    }
    if (this.negotiation.outgoingNoContextTakeover) this.deflater.reset();
    return compressed;
  }

  async decompress(message: Uint8Array, maxOutputBytes: number): Promise<Uint8Array> {
    this.requireOpen();
    let output: Uint8Array;
    try {
      output = await this.inflater.process(
        concatBytes([message, tail], message.length + 4),
        maxOutputBytes,
      );
    } catch (error) {
      if (error instanceof LimitError) throw error;
      throw new ProtocolError("Invalid permessage-deflate payload");
    }
    if (output.length > maxOutputBytes) {
      throw new LimitError("Inflated WebSocket message exceeds configured limit");
    }
    if (this.negotiation.incomingNoContextTakeover) this.inflater.reset();
    return output;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.inflater.close();
    this.deflater.close();
  }

  private requireOpen(): void {
    if (this.closed) throw new TypeError("permessage-deflate context is closed");
  }
}

/**
 * A server's answer to a client's `permessage-deflate` offer.
 *
 * Directions are named from the server's side: `incoming` is client-to-server, which
 * the `client_*` parameters govern, and `outgoing` is server-to-client, which the
 * `server_*` parameters govern. Getting that backwards produces a session that
 * negotiates successfully and then cannot decompress, so the names say whose traffic
 * they describe rather than whose parameter they came from.
 */
export interface PerMessageDeflateServerNegotiation {
  /** The exact `Sec-WebSocket-Extensions` value to send back. */
  readonly response: string;
  readonly incomingNoContextTakeover: boolean;
  readonly outgoingNoContextTakeover: boolean;
  readonly incomingWindowBits: number;
  readonly outgoingWindowBits: number;
}

/** RFC 7692 window bits: decimal digits only, 8 through 15, no sign and no padding. */
function windowBits(value: string | null): number | null {
  if (value === null || value.length === 0 || value.length > 2) return null;
  let bits = 0;
  for (let index = 0; index < value.length; index++) {
    const digit = value.charCodeAt(index) - 0x30;
    if (digit < 0 || digit > 9) return null;
    bits = bits * 10 + digit;
  }
  return bits >= 8 && bits <= 15 ? bits : null;
}

/**
 * Chooses a server response to a client's extension offer, or declines.
 *
 * The client may send several `permessage-deflate` entries in preference order; the
 * first one whose parameters can be honoured exactly is accepted and the rest are
 * ignored, which is what RFC 7692 asks of a server. An entry carrying a parameter this
 * implementation does not know, a duplicate parameter, or an out-of-range window is
 * not negotiable and the next entry is tried — accepting an offer while ignoring part
 * of it would agree to something neither side then implements.
 *
 * Declining is always valid and is what an absent or unusable offer produces.
 */
export function negotiatePerMessageDeflateOffer(
  header: string | null,
): PerMessageDeflateServerNegotiation | null {
  if (header === null) return null;
  for (const extension of parseExtensions(header)) {
    if (extension.name !== "permessage-deflate") continue;
    let incomingNoContextTakeover = false;
    let outgoingNoContextTakeover = false;
    let outgoingWindowBits = 15;
    let clientWindowBits: number | null = null;
    let clientSupportsWindowLimit = false;
    let usable = true;
    const seen = new Set<string>();
    for (const parameter of extension.parameters) {
      if (seen.has(parameter.name)) {
        usable = false;
        break;
      }
      seen.add(parameter.name);
      if (parameter.name === "server_no_context_takeover") {
        if (parameter.value !== null) usable = false;
        outgoingNoContextTakeover = true;
      } else if (parameter.name === "client_no_context_takeover") {
        if (parameter.value !== null) usable = false;
        incomingNoContextTakeover = true;
      } else if (parameter.name === "server_max_window_bits") {
        // A bare parameter leaves the choice to the server; a value is a ceiling.
        if (parameter.value !== null) {
          const bits = windowBits(parameter.value);
          if (bits === null) usable = false;
          else outgoingWindowBits = bits;
        }
      } else if (parameter.name === "client_max_window_bits") {
        clientSupportsWindowLimit = true;
        if (parameter.value !== null) {
          const bits = windowBits(parameter.value);
          if (bits === null) usable = false;
          else clientWindowBits = bits;
        }
      } else {
        usable = false;
      }
      if (!usable) break;
    }
    if (!usable) continue;

    let response = "permessage-deflate";
    if (outgoingNoContextTakeover) response += "; server_no_context_takeover";
    if (incomingNoContextTakeover) response += "; client_no_context_takeover";
    if (outgoingWindowBits !== 15)
      response += "; server_max_window_bits=" + String(outgoingWindowBits);
    // `client_max_window_bits` may appear in the response only if the client showed it
    // understands the parameter. Sending it otherwise fails the handshake at a
    // conforming client, so the offer decides whether it is even mentionable.
    if (clientSupportsWindowLimit && clientWindowBits !== null) {
      response += "; client_max_window_bits=" + String(clientWindowBits);
    }
    return {
      response,
      incomingNoContextTakeover,
      outgoingNoContextTakeover,
      incomingWindowBits: clientWindowBits ?? 15,
      outgoingWindowBits,
    };
  }
  return null;
}

function parseExtensions(header: string): Extension[] {
  const extensions: Extension[] = [];
  for (const item of splitOutsideQuotes(header, 44)) {
    const parts = splitOutsideQuotes(item, 59);
    const name = (parts.shift() ?? "").trim().toLowerCase();
    if (!isToken(name)) throw new ProtocolError("Invalid WebSocket extension name");
    const parameters: ExtensionParameter[] = [];
    for (const part of parts) parameters.push(parseParameter(part));
    extensions.push({ name, parameters });
  }
  return extensions;
}

function parseParameter(input: string): ExtensionParameter {
  const part = input.trim();
  const equals = part.indexOf("=");
  const name = (equals < 0 ? part : part.slice(0, equals)).trim().toLowerCase();
  if (!isToken(name)) throw new ProtocolError("Invalid WebSocket extension parameter");
  if (equals < 0) return { name, value: null };
  const raw = part.slice(equals + 1).trim();
  const value = raw.startsWith('"') ? decodeQuoted(raw) : raw;
  if (!isToken(value)) throw new ProtocolError("Invalid WebSocket extension parameter value");
  return { name, value };
}

function decodeQuoted(input: string): string {
  if (input.length < 2 || input.charCodeAt(input.length - 1) !== 34) {
    throw new ProtocolError("Unterminated WebSocket extension parameter");
  }
  let value = "";
  for (let index = 1; index < input.length - 1; index++) {
    const code = input.charCodeAt(index);
    if (code === 92) {
      if (++index >= input.length - 1) {
        throw new ProtocolError("Invalid quoted WebSocket extension parameter");
      }
      const escaped = input.charCodeAt(index);
      if (escaped < 33 || escaped > 126) {
        throw new ProtocolError("Invalid quoted WebSocket extension escape");
      }
      value += input.charAt(index);
    } else {
      if (code === 34 || code < 32 || code === 127) {
        throw new ProtocolError("Invalid quoted WebSocket extension parameter");
      }
      value += input.charAt(index);
    }
  }
  return value;
}

function splitOutsideQuotes(input: string, delimiter: number): string[] {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    if (escaped) escaped = false;
    else if (quoted && code === 92) escaped = true;
    else if (code === 34) quoted = !quoted;
    else if (!quoted && code === delimiter) {
      const part = input.slice(start, index).trim();
      if (part === "") throw new ProtocolError("Empty WebSocket extension element");
      parts.push(part);
      start = index + 1;
    }
  }
  if (quoted || escaped) throw new ProtocolError("Unterminated WebSocket extension quote");
  const part = input.slice(start).trim();
  if (part === "") throw new ProtocolError("Empty WebSocket extension element");
  parts.push(part);
  return parts;
}

function requireValueless(parameter: ExtensionParameter): void {
  if (parameter.value !== null) {
    throw new ProtocolError("Context-takeover parameters do not accept values");
  }
}

function parseWindowBits(value: string | null): number {
  if (value === null || !/^(?:[89]|1[0-5])$/.test(value)) {
    throw new ProtocolError("Invalid permessage-deflate window size");
  }
  return Number(value);
}

function hasTail(bytes: Uint8Array): boolean {
  if (bytes.length < tail.length) return false;
  const offset = bytes.length - tail.length;
  for (let index = 0; index < tail.length; index++) {
    if (bytes[offset + index] !== tail[index]) return false;
  }
  return true;
}
