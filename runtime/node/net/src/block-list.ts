// `net.BlockList` and `net.SocketAddress`, represented with fixed-width
// numeric addresses and an intrusive rule list.
//
// Node keeps the same data in a native trie. The public operations do not
// require a dynamic object model, though: an address is a 32- or 128-bit
// integer and a rule is an address, inclusive range, or prefix. Keeping the
// rule storage linked means adding a rule never grows or copies an array;
// `rules` allocates its public snapshot at the exact final size.

import {
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_OUT_OF_RANGE,
} from "../../internal/errors.ts";
import { validateNumber, validateString } from "../../internal/validators.ts";

export type IPFamily = "ipv4" | "ipv6";

export interface SocketAddressOptions {
  address?: string | undefined;
  port?: number | undefined;
  family?: string | undefined;
  flowlabel?: number | undefined;
}

interface ParsedAddress {
  family: IPFamily;
  value: bigint;
  text: string;
}

export class SocketAddress {
  readonly address: string;
  readonly port: number;
  readonly family: IPFamily;
  readonly flowlabel: number;
  readonly numericValue: bigint;

  constructor(options: SocketAddressOptions = {}) {
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
      throw new ERR_INVALID_ARG_TYPE("options", "Object", options);
    }
    const family = normaliseFamily(options.family ?? "ipv4", "options.family");
    const address = options.address ?? (family === "ipv4" ? "127.0.0.1" : "::");
    validateString(address, "options.address");
    const parsed = parseAddress(address, family);
    if (parsed === undefined || parsed.family !== family) {
      throw new ERR_INVALID_ARG_VALUE("options.address", address);
    }

    const port = options.port ?? 0;
    validateNumber(port, "options.port");
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new ERR_OUT_OF_RANGE("options.port", ">= 0 and <= 65535", port);
    }

    const flowlabel = options.flowlabel ?? 0;
    validateNumber(flowlabel, "options.flowlabel");
    if (!Number.isInteger(flowlabel) || flowlabel < 0 || flowlabel > 0xfffff) {
      throw new ERR_OUT_OF_RANGE("options.flowlabel", ">= 0 and <= 1048575", flowlabel);
    }

    this.address = parsed.text;
    this.port = port;
    this.family = family;
    this.flowlabel = flowlabel;
    this.numericValue = parsed.value;
  }

  static isSocketAddress(value: unknown): value is SocketAddress {
    return value instanceof SocketAddress;
  }

  static parse(input: string): SocketAddress | undefined {
    validateString(input, "input");
    if (input.startsWith("[")) {
      const closing = input.indexOf("]");
      if (closing < 0 || input[closing + 1] !== ":") return undefined;
      const port = parseDecimalPort(input.slice(closing + 2));
      if (port === undefined) return undefined;
      try {
        return new SocketAddress({
          address: input.slice(1, closing),
          port,
          family: "ipv6",
        });
      } catch {
        return undefined;
      }
    }

    const colon = input.lastIndexOf(":");
    if (colon < 0) return undefined;
    const port = parseDecimalPort(input.slice(colon + 1));
    if (port === undefined) return undefined;
    try {
      return new SocketAddress({ address: input.slice(0, colon), port });
    } catch {
      return undefined;
    }
  }

  toJSON(): SocketAddressOptions {
    return {
      address: this.address,
      port: this.port,
      family: this.family,
      flowlabel: this.flowlabel,
    };
  }
}

type RuleKind = "Address" | "Range" | "Subnet";

class BlockRule {
  readonly kind: RuleKind;
  readonly family: IPFamily;
  readonly start: bigint;
  readonly end: bigint;
  readonly prefix: number;
  readonly text: string;
  readonly next: BlockRule | null;

  constructor(
    kind: RuleKind,
    family: IPFamily,
    start: bigint,
    end: bigint,
    prefix: number,
    text: string,
    next: BlockRule | null,
  ) {
    this.kind = kind;
    this.family = family;
    this.start = start;
    this.end = end;
    this.prefix = prefix;
    this.text = text;
    this.next = next;
  }

  matches(address: ParsedAddress): boolean {
    if (address.family !== this.family) return false;
    if (this.kind === "Address") return address.value === this.start;
    if (this.kind === "Range") {
      return address.value >= this.start && address.value <= this.end;
    }
    const width = this.family === "ipv4" ? 32 : 128;
    const shift = BigInt(width - this.prefix);
    return (address.value >> shift) === (this.start >> shift);
  }
}

export class BlockList {
  #first: BlockRule | null = null;
  #size = 0;

  static isBlockList(value: unknown): value is BlockList {
    return value instanceof BlockList;
  }

  addAddress(address: string | SocketAddress, family = "ipv4"): void {
    const parsed = addressFromInput(address, family, "address");
    this.#addRule(
      "Address",
      parsed,
      parsed.value,
      0,
      `Address: ${familyLabel(parsed.family)} ${parsed.text}`,
    );
  }

  addRange(
    start: string | SocketAddress,
    end: string | SocketAddress,
    family = "ipv4",
  ): void {
    const parsedStart = addressFromInput(start, family, "start");
    const parsedEnd = addressFromInput(end, family, "end");
    if (parsedStart.family !== parsedEnd.family || parsedStart.value > parsedEnd.value) {
      throw new ERR_INVALID_ARG_VALUE("start", start, "must come before end");
    }
    this.#addRule(
      "Range",
      parsedStart,
      parsedEnd.value,
      0,
      `Range: ${familyLabel(parsedStart.family)} ${parsedStart.text}-${parsedEnd.text}`,
    );
  }

  addSubnet(network: string | SocketAddress, prefix: number, family = "ipv4"): void {
    const parsed = addressFromInput(network, family, "network");
    validateNumber(prefix, "prefix");
    const maximum = parsed.family === "ipv4" ? 32 : 128;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > maximum) {
      throw new ERR_OUT_OF_RANGE("prefix", `>= 0 and <= ${maximum}`, prefix);
    }
    // Arithmetic coercion is intentional: the public value must not retain
    // JavaScript's observable negative-zero distinction.
    prefix += 0;
    this.#addRule(
      "Subnet",
      parsed,
      parsed.value,
      prefix,
      `Subnet: ${familyLabel(parsed.family)} ${parsed.text}/${prefix}`,
    );
  }

  check(address: string | SocketAddress, family = "ipv4"): boolean {
    let parsed: ParsedAddress;
    if (address instanceof SocketAddress) {
      parsed = socketAddressValue(address);
    } else {
      validateString(address, "address");
      const normalisedFamily = normaliseFamily(family, "family");
      const result = parseAddress(address, normalisedFamily);
      if (result === undefined) return false;
      parsed = result;
    }

    for (let rule = this.#first; rule !== null; rule = rule.next) {
      if (rule.matches(parsed)) return true;
    }
    return false;
  }

  get rules(): string[] {
    const result = new Array<string>(this.#size);
    let index = 0;
    for (let rule = this.#first; rule !== null; rule = rule.next) {
      result[index++] = rule.text;
    }
    return result;
  }

  toJSON(): string[] {
    return this.rules;
  }

  fromJSON(data: string | string[]): void {
    let rules: unknown;
    if (typeof data === "string") {
      try {
        rules = JSON.parse(data);
      } catch {
        throw new ERR_INVALID_ARG_TYPE("data", ["string", "string[]"], data);
      }
    } else {
      rules = data;
    }
    if (!Array.isArray(rules)) {
      throw new ERR_INVALID_ARG_TYPE("data", ["string", "string[]"], data);
    }
    for (let index = 0; index < rules.length; index++) {
      if (typeof rules[index] !== "string") {
        throw new ERR_INVALID_ARG_TYPE("data", ["string", "string[]"], data);
      }
    }
    for (let index = 0; index < rules.length; index++) {
      this.#parseRule(rules[index]);
    }
  }

  #addRule(
    kind: RuleKind,
    start: ParsedAddress,
    end: bigint,
    prefix: number,
    text: string,
  ): void {
    this.#first = new BlockRule(
      kind,
      start.family,
      start.value,
      end,
      prefix,
      text,
      this.#first,
    );
    this.#size++;
  }

  #parseRule(rule: string): void {
    const addressPrefix = "Address: ";
    const rangePrefix = "Range: ";
    const subnetPrefix = "Subnet: ";
    if (rule.startsWith(addressPrefix)) {
      const body = parseRuleFamily(rule.slice(addressPrefix.length));
      if (body !== undefined) this.addAddress(body.value, body.family);
      return;
    }
    if (rule.startsWith(rangePrefix)) {
      const body = parseRuleFamily(rule.slice(rangePrefix.length));
      if (body === undefined) return;
      const separator = body.value.indexOf("-");
      if (separator > 0) {
        this.addRange(
          body.value.slice(0, separator),
          body.value.slice(separator + 1),
          body.family,
        );
      }
      return;
    }
    if (rule.startsWith(subnetPrefix)) {
      const body = parseRuleFamily(rule.slice(subnetPrefix.length));
      if (body === undefined) return;
      const separator = body.value.lastIndexOf("/");
      if (separator > 0) {
        const prefix = Number.parseInt(body.value.slice(separator + 1), 10);
        if (Number.isInteger(prefix)) {
          this.addSubnet(body.value.slice(0, separator), prefix, body.family);
        }
      }
    }
  }
}

function addressFromInput(
  input: string | SocketAddress,
  family: string,
  name: string,
): ParsedAddress {
  if (input instanceof SocketAddress) return socketAddressValue(input);
  validateString(input, name);
  const normalisedFamily = normaliseFamily(family, "family");
  const parsed = parseAddress(input, normalisedFamily);
  if (parsed === undefined) throw new ERR_INVALID_ARG_VALUE(name, input);
  return parsed;
}

function socketAddressValue(address: SocketAddress): ParsedAddress {
  return {
    family: address.family,
    value: address.numericValue,
    text: address.address,
  };
}

function normaliseFamily(value: unknown, name: string): IPFamily {
  validateString(value, name);
  const family = value.toLowerCase();
  if (family === "ipv4" || family === "ipv6") return family;
  throw new ERR_INVALID_ARG_VALUE(name, value);
}

function familyLabel(family: IPFamily): "IPv4" | "IPv6" {
  return family === "ipv4" ? "IPv4" : "IPv6";
}

function parseAddress(text: string, requestedFamily: IPFamily): ParsedAddress | undefined {
  if (requestedFamily === "ipv4") return parseIPv4(text);
  return parseIPv6(text);
}

function parseIPv4(text: string): ParsedAddress | undefined {
  let value = 0n;
  let start = 0;
  for (let part = 0; part < 4; part++) {
    const dot = part === 3 ? text.length : text.indexOf(".", start);
    if (dot < start || (part < 3 && dot === text.length)) return undefined;
    const segment = parseDecimalByte(text.slice(start, dot));
    if (segment === undefined) return undefined;
    value = (value << 8n) | BigInt(segment);
    start = dot + 1;
  }
  if (start !== text.length + 1) return undefined;
  return { family: "ipv4", value, text: formatIPv4(value) };
}

function parseIPv6(text: string): ParsedAddress | undefined {
  const zone = text.indexOf("%");
  const address = zone < 0 ? text : text.slice(0, zone);
  if (address.length === 0) return undefined;

  let expanded = address;
  const lastColon = address.lastIndexOf(":");
  const dotted = address.slice(lastColon + 1);
  if (dotted.includes(".")) {
    const ipv4 = parseIPv4(dotted);
    if (ipv4 === undefined) return undefined;
    const high = Number((ipv4.value >> 16n) & 0xffffn).toString(16);
    const low = Number(ipv4.value & 0xffffn).toString(16);
    expanded = `${address.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const compression = expanded.indexOf("::");
  if (compression !== expanded.lastIndexOf("::")) return undefined;
  const left = compression < 0 ? expanded : expanded.slice(0, compression);
  const right = compression < 0 ? "" : expanded.slice(compression + 2);
  const leftCount = countGroups(left);
  const rightCount = countGroups(right);
  if (leftCount < 0 || rightCount < 0) return undefined;
  if (compression < 0 && leftCount !== 8) return undefined;
  if (compression >= 0 && leftCount + rightCount >= 8) return undefined;

  const omitted = compression < 0 ? 0 : 8 - leftCount - rightCount;
  let value = 0n;
  let cursor = 0;
  for (let index = 0; index < leftCount; index++) {
    const next = left.indexOf(":", cursor);
    const end = next < 0 ? left.length : next;
    const group = parseHexGroup(left.slice(cursor, end));
    if (group === undefined) return undefined;
    value = (value << 16n) | BigInt(group);
    cursor = end + 1;
  }
  for (let index = 0; index < omitted; index++) value <<= 16n;
  cursor = 0;
  for (let index = 0; index < rightCount; index++) {
    const next = right.indexOf(":", cursor);
    const end = next < 0 ? right.length : next;
    const group = parseHexGroup(right.slice(cursor, end));
    if (group === undefined) return undefined;
    value = (value << 16n) | BigInt(group);
    cursor = end + 1;
  }

  // IPv4-mapped IPv6 addresses compare as IPv4 in Node's block list.
  if ((value >> 32n) === 0xffffn) {
    const ipv4 = value & 0xffffffffn;
    return { family: "ipv4", value: ipv4, text: formatIPv4(ipv4) };
  }
  return { family: "ipv6", value, text: formatIPv6(value) };
}

function countGroups(part: string): number {
  if (part.length === 0) return 0;
  let count = 1;
  for (let index = 0; index < part.length; index++) {
    if (part[index] === ":") count++;
  }
  return count;
}

function parseDecimalByte(text: string): number | undefined {
  if (text.length === 0 || (text.length > 1 && text[0] === "0")) return undefined;
  let value = 0;
  for (let index = 0; index < text.length; index++) {
    const digit = text.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) return undefined;
    value = value * 10 + digit;
  }
  return value <= 255 ? value : undefined;
}

function parseDecimalPort(text: string): number | undefined {
  if (text.length === 0) return undefined;
  let value = 0;
  for (let index = 0; index < text.length; index++) {
    const digit = text.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) return undefined;
    value = value * 10 + digit;
  }
  return value <= 65535 ? value : undefined;
}

function parseHexGroup(text: string): number | undefined {
  if (text.length === 0 || text.length > 4) return undefined;
  let value = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    let digit: number;
    if (code >= 48 && code <= 57) digit = code - 48;
    else if (code >= 65 && code <= 70) digit = code - 55;
    else if (code >= 97 && code <= 102) digit = code - 87;
    else return undefined;
    value = value * 16 + digit;
  }
  return value;
}

function formatIPv4(value: bigint): string {
  return `${Number((value >> 24n) & 255n)}.${Number((value >> 16n) & 255n)}.` +
    `${Number((value >> 8n) & 255n)}.${Number(value & 255n)}`;
}

function formatIPv6(value: bigint): string {
  const groups = new Array<number>(8);
  let remaining = value;
  for (let index = 7; index >= 0; index--) {
    groups[index] = Number(remaining & 0xffffn);
    remaining >>= 16n;
  }

  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < groups.length;) {
    if (groups[index] !== 0) {
      index++;
      continue;
    }
    const start = index;
    while (index < groups.length && groups[index] === 0) index++;
    const length = index - start;
    if (length > bestLength && length > 1) {
      bestStart = start;
      bestLength = length;
    }
  }

  let text = "";
  for (let index = 0; index < groups.length; index++) {
    if (index === bestStart) {
      text += "::";
      index += bestLength - 1;
      continue;
    }
    if (text.length > 0 && !text.endsWith(":")) text += ":";
    const group = groups[index];
    if (group !== undefined) text += group.toString(16);
  }
  return text.length === 0 ? "::" : text;
}

function parseRuleFamily(body: string): { family: IPFamily; value: string } | undefined {
  if (body.startsWith("IPv4 ")) return { family: "ipv4", value: body.slice(5) };
  if (body.startsWith("IPv6 ")) return { family: "ipv6", value: body.slice(5) };
  return undefined;
}
