// `net.BlockList` and `net.SocketAddress`, represented with fixed-width
// numeric addresses and an intrusive rule list.
//
// Node keeps the same data in a native trie. The public operations do not
// require a dynamic object model, though: an address is a 32- or 128-bit
// integer and a rule is an address, inclusive range, or prefix. Keeping the
// rule storage linked means adding a rule never grows or copies an array;
// `rules` allocates its public snapshot at the exact final size.

import { URL } from "../../url/src/url.ts";
import {
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ADDRESS,
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
  /**
   * `SocketAddress.parse`, node `lib/internal/socketaddress.js:150`.
   *
   * **Through `URL`, deliberately, because the quirk belongs to `URL`.** Node
   * parses `http://${input}` and reads `hostname` and `port`, so a URL's rules
   * show through the whole way: `1.2.3.4:80` answers port **0**, because 80 is
   * http's default and `URL` reports an empty `port` for it, and `port | 0`
   * turns that into zero. `[::ffff:1.2.3.4]:8` keeps 8. A bare `::1` is
   * `undefined` where `[::1]` is not, because a bare colon-address is not a
   * valid URL host.
   *
   * Writing that by hand means `if (port === 80) port = 0` under a comment
   * explaining a component this function did not call, which is the shape of
   * three defects found in this profile on 2026-09-10 -- each sitting under a
   * confident comment about behaviour the author had not gone and read.
   *
   * **It does not lower today and that is known rather than discovered.**
   * `URL#constructor` is refused, so `fileURLToPath`, `pathToFileURL` and
   * `fileURLToPathBuffer` are already `NTS1003` on it and this joins them. The
   * interpreted lane gains the function; the compiled lane gains it when that
   * constructor does. Nothing `net` already publishes is affected, because
   * refusals are per-function and cascade along call edges.
   */
  static parse(input: string): SocketAddress | undefined {
    validateString(input, "input");
    // Node wraps the whole body: `URL.parse` answers `null` rather than
    // throwing, and it is the destructuring of that `null` and the
    // `SocketAddress` constructor below that throw. The catch is what turns an
    // unparseable input into `undefined`.
    try {
      const parsed = URL.parse(`http://${input}`);
      if (parsed === null) return undefined;
      const address = parsed.hostname;
      const port = Number(parsed.port) | 0;
      if (address.startsWith("[") && address.endsWith("]")) {
        return new SocketAddress({
          address: address.slice(1, -1),
          port,
          family: "ipv6",
        });
      }
      return new SocketAddress({ address, port });
    } catch {
      return undefined;
    }
  }

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
    // **Cross-family matching is where the IPv4-mapped equivalence lives.** Node
    // matches `check("1.2.3.4")` against a rule added as `::ffff:1.2.3.4` and
    // the reverse, so the value is mapped into the rule's family here rather
    // than the address being downgraded when it was parsed.
    let value = address.value;
    if (address.family !== this.family) {
      if (this.family === "ipv6" && address.family === "ipv4") {
        value = address.value | MAPPED_PREFIX;
      } else if (this.family === "ipv4" && (address.value >> 32n) === 0xffffn) {
        value = address.value & 0xffffffffn;
      } else {
        return false;
      }
    }
    if (this.kind === "Address") return value === this.start;
    if (this.kind === "Range") {
      return value >= this.start && value <= this.end;
    }
    const width = this.family === "ipv4" ? 32 : 128;
    const shift = BigInt(width - this.prefix);
    return (value >> shift) === (this.start >> shift);
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
  // Node raises `ERR_INVALID_ADDRESS` here, an `Error` with the fixed message
  // "Invalid socket address", not `ERR_INVALID_ARG_VALUE`. The *family*
  // validation below is a different contract and does use
  // `ERR_INVALID_ARG_VALUE` as a `TypeError`, so the two are not
  // interchangeable -- checking both against node before changing either is
  // what kept the family case from being broken along with this fix.
  if (parsed === undefined) throw new ERR_INVALID_ADDRESS();
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

  // **A mapped address stays IPv6 here.** This used to answer
  // `{ family: "ipv4", … }` under a comment saying "IPv4-mapped IPv6 addresses
  // compare as IPv4 in Node's block list", and half of that is true: they
  // *compare* as IPv4, at comparison time, which `BlockRule.matches` now does.
  // Node keeps the rule itself IPv6 -- `addAddress("::ffff:1.2.3.4", "ipv6")`
  // lists `Address: IPv6 ::ffff:1.2.3.4` there and listed
  // `Address: IPv4 1.2.3.4` here.
  //
  // Downgrading at parse time also broke a call that should work:
  // `addSubnet("::ffff:1.2.3.0", 120, "ipv6")` validated 120 against IPv4's
  // 32-bit width and threw `ERR_OUT_OF_RANGE`, where node accepts it.
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

/** `::ffff:a.b.c.d`'s high 96 bits, which is what makes an address IPv4-mapped. */
const MAPPED_PREFIX = 0xffff00000000n;

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

  // **The dotted tail, which is `inet_ntop`'s rule and node's.** The last two
  // groups print as `a.b.c.d` when the run of zeros starts at group 0 and is
  // either six long -- `::a:1` is `::0.10.0.1` -- or five long followed by
  // `ffff`, the IPv4-mapped form. Measured against node rather than derived:
  //
  //     ::2          -> ::2            run of 7, so no dotted tail
  //     ::a:1        -> ::0.10.0.1     run of 6
  //     ::0.1.0.0    -> ::0.1.0.0      run of 6, second half zero
  //     ::1:0:0      -> ::1:0:0        run of 5 and group 5 is not ffff
  //     ::ffff:0:1   -> ::ffff:0.0.0.1 run of 5 and group 5 is ffff
  //
  // A first version special-cased only the mapped form and left `::a:1` reading
  // `::a:1` where node reads `::0.10.0.1`. The rule text is what `BlockList`
  // compares, so this is observable rather than cosmetic.
  if (bestStart === 0 && (bestLength === 6 || (bestLength === 5 && groups[5] === 0xffff))) {
    const dotted = formatIPv4(value & 0xffffffffn);
    return bestLength === 5 ? `::ffff:${dotted}` : `::${dotted}`;
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
