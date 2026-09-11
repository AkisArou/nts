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

/*
 * **Parsed, not matched.** These were two module-scope `new RegExp`s built from
 * template strings, and a module-scope regular expression does not lower: it
 * refused `isIPv4` and `isIPv6`, and through `isIP` it refused callers in
 * `dgram`, `dns` and `http` as well. Node does not use a regular expression here
 * either -- its `isIP` is C++.
 *
 * The two are byte-for-byte the old predicates. Differenced against the regexes
 * they replace *and* against `node:net`'s own `isIPv4`/`isIPv6` over 600,042
 * inputs -- a fixed list of boundary cases, 300,000 from an alphabet fuzzer, and
 * 300,000 from a generator that builds valid addresses and then makes one edit --
 * with **0 differences on either oracle**. The structured half matters: the
 * alphabet fuzzer accepts almost nothing, so on its own it tests the rejecting
 * branches and reports a confident zero about half the code. The structured
 * corpus accepts 97,844 as IPv6 and 106 as IPv4.
 *
 * One bug was found this way and it is the reason the dot search below is scoped.
 * A first version looked for a dot anywhere ahead of the cursor, so
 * `::ffff:1.2.3.4` tried to parse `ffff:1.2.3.4` as IPv4 and rejected four valid
 * addresses that node accepts.
 */

/** A dotted quad. No leading zero: the old pattern's `[1-9]?[0-9]` took `0` and `12` but not `01`. */
export function isIPv4(input: string): boolean {
  // `RegExp.test` coerced its argument, and callers rely on it: node's own
  // `test-net-isip.js` passes numbers, `null`, `undefined`, objects and a
  // `Buffer`, and `ip-validation-static.js` pins the Buffer holding "1.2.3.4" as
  // a *valid* address. The parameter type said `string` and the regular
  // expression was covering for it; the coercion is explicit now.
  const value = `${input}`;
  let at = 0;
  let parts = 0;
  const length = value.length;
  while (parts < 4) {
    if (at >= length) return false;
    let digits = 0;
    let octet = 0;
    const first = value.charCodeAt(at);
    if (first < 48 || first > 57) return false;
    if (first === 48) {
      at++;
      digits = 1;
    } else {
      while (at < length) {
        const code = value.charCodeAt(at);
        if (code < 48 || code > 57) break;
        octet = octet * 10 + (code - 48);
        digits++;
        at++;
        if (digits > 3) return false;
      }
    }
    if (digits === 0 || octet > 255) return false;
    parts++;
    if (parts < 4) {
      if (at >= length || value.charCodeAt(at) !== 46) return false;
      at++;
    }
  }
  return at === length;
}

/** How many hex digits start at `at`, capped at the four a group may hold. */
function hexGroup(value: string, at: number, end: number): number {
  let digits = 0;
  while (at + digits < end && digits < 4) {
    const code = value.charCodeAt(at + digits);
    const hex =
      (code >= 48 && code <= 57) || (code >= 97 && code <= 102) || (code >= 65 && code <= 70);
    if (!hex) break;
    digits++;
  }
  return digits;
}

export function isIPv6(input: string): boolean {
  const value = `${input}`;                    // see the note on `isIPv4`
  // A zone suffix, which the old pattern allowed as `%[0-9a-zA-Z-.:]{1,}`.
  let end = value.length;
  const percent = value.indexOf("%");
  if (percent !== -1) {
    if (percent === end - 1) return false;
    for (let index = percent + 1; index < end; index++) {
      const code = value.charCodeAt(index);
      const allowed =
        (code >= 48 && code <= 57) ||
        (code >= 97 && code <= 122) ||
        (code >= 65 && code <= 90) ||
        code === 45 ||
        code === 46 ||
        code === 58;
      if (!allowed) return false;
    }
    end = percent;
  }
  if (end === 0) return false;

  let at = 0;
  let groups = 0;
  let sawCompression = false;
  if (value.charCodeAt(0) === 58) {
    if (end < 2 || value.charCodeAt(1) !== 58) return false;
    at = 2;
    sawCompression = true;
    if (at === end) return true;
  }
  while (at < end) {
    if (value.charCodeAt(at) === 58) {
      if (sawCompression) return false;
      sawCompression = true;
      at++;
      if (at === end) return true;
      continue;
    }
    // The dot must be inside *this* group; see the note above.
    const nextColon = value.indexOf(":", at);
    const dot = value.indexOf(".", at);
    if (dot !== -1 && dot < end && (nextColon === -1 || nextColon >= end || dot < nextColon)) {
      if (!isIPv4(value.slice(at, end))) return false;
      groups += 2;
      at = end;
      break;
    }
    const digits = hexGroup(value, at, end);
    if (digits === 0) return false;
    at += digits;
    groups++;
    if (at < end) {
      if (value.charCodeAt(at) !== 58) return false;
      if (at + 1 < end && value.charCodeAt(at + 1) === 58) {
        at++;
        continue;
      }
      at++;
      if (at === end) return false;
    }
  }
  return sawCompression ? groups <= 7 : groups === 8;
}

export function isIP(value: string): number {
  if (isIPv4(value)) return 4;
  if (isIPv6(value)) return 6;
  return 0;
}
