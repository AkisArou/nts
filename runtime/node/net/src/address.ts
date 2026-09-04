// Recognising an address, from node v24.20.0 `lib/internal/net.js`.
//
// `net.isIP` is not decoration: `net.connect` behaves differently for a
// literal address and a hostname -- one goes straight to the socket layer, the
// other through a resolver -- so getting this wrong turns a connection into a
// DNS lookup for something that was never a name.
//
// The expressions are node's own, transcribed. Writing a new one would be a
// mistake: an IPv6 address has eight groups, may elide a run of zeroes exactly
// once, may end in a dotted-quad, and may carry a zone identifier, and every
// simplification of that is a rule that accepts something the socket layer
// will not.

const IPv4Segment = "(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])";
const IPv4Address = `(?:${IPv4Segment}\\.){3}${IPv4Segment}`;
const IPv4Regex = new RegExp(`^${IPv4Address}$`);

const IPv6Segment = "[0-9a-fA-F]{1,4}";
const IPv6Regex = new RegExp(
  "^(?:" +
    `(?:${IPv6Segment}:){7}(?:${IPv6Segment}|:)|` +
    `(?:${IPv6Segment}:){6}(?:${IPv4Address}|:${IPv6Segment}|:)|` +
    `(?:${IPv6Segment}:){5}(?::${IPv4Address}|(?::${IPv6Segment}){1,2}|:)|` +
    `(?:${IPv6Segment}:){4}(?:(?::${IPv6Segment}){0,1}:${IPv4Address}|(?::${IPv6Segment}){1,3}|:)|` +
    `(?:${IPv6Segment}:){3}(?:(?::${IPv6Segment}){0,2}:${IPv4Address}|(?::${IPv6Segment}){1,4}|:)|` +
    `(?:${IPv6Segment}:){2}(?:(?::${IPv6Segment}){0,3}:${IPv4Address}|(?::${IPv6Segment}){1,5}|:)|` +
    `(?:${IPv6Segment}:){1}(?:(?::${IPv6Segment}){0,4}:${IPv4Address}|(?::${IPv6Segment}){1,6}|:)|` +
    `(?::(?:(?::${IPv6Segment}){0,5}:${IPv4Address}|(?::${IPv6Segment}){1,7}|:))` +
    ")(?:%[0-9a-zA-Z-.:]{1,})?$",
);

export function isIPv4(value: string): boolean {
  return IPv4Regex.test(value);
}

export function isIPv6(value: string): boolean {
  return IPv6Regex.test(value);
}

/** `4`, `6`, or `0` for something that is not a literal address. */
export function isIP(value: string): number {
  if (isIPv4(value)) return 4;
  if (isIPv6(value)) return 6;
  return 0;
}
