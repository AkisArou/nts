// `url.domainToASCII` and `url.domainToUnicode`.
//
// These are not the IDNA mapping, which is what they look like. Node parses the
// argument as the *host* of a special-scheme URL and serialises the result, so
// they inherit everything host parsing does:
//
//     domainToASCII("0x7f.1")        -> "127.0.0.1"     IPv4 shorthand
//     domainToASCII("2130706433")    -> "127.0.0.1"
//     domainToASCII("[::FFFF:1.2.3.4]") -> "[::ffff:102:304]"   IPv6 canonical
//     domainToASCII("999.999.999.999")  -> ""           an IPv4 that is not one
//     domainToASCII("1.2.3.4//x#f")  -> "1.2.3.4"       delimiters end a domain
//     domainToASCII("a:80")          -> ""              `:` is not a delimiter
//
// This lives beside the parser rather than in `idna.ts` because it needs the
// IPv4 and IPv6 parsers, and `parser.ts` already depends on `idna.ts` -- the
// other direction would be a cycle.
//
// Found by differential: the previous implementation applied the IDNA mapping
// to the whole argument and returned it unchanged when it could not, so
// `domainToASCII("http://a")` was `"http://a"` where node gives `""`. Over
// 4,000 generated URLs that was 8,046 divergences, none of them reachable by a
// pinned test.

import { toUnicode as punycodeToUnicode } from "../../punycode/src/codec.ts";
import { beforeDelimiter } from "./idna.ts";
import { parseHost } from "./parser.ts";

/** The Punycode ASCII serialisation of a domain, or `""` if it is not one. */
export function domainToASCII(domain: string): string {
  return parseHost(beforeDelimiter(domain), false) ?? "";
}

/**
 * The same host, spelled in Unicode.
 *
 * Node produces this from the ASCII form rather than from the input, so an
 * IPv4 shorthand is canonicalised on the way through -- `domainToUnicode
 * ("0x7f.1")` is `"127.0.0.1"`. An address literal has no `xn--` label, so the
 * decoder leaves `"[::1]"` and `"127.0.0.1"` alone.
 */
export function domainToUnicode(domain: string): string {
  const ascii = domainToASCII(domain);
  if (ascii === "") return "";
  try {
    return punycodeToUnicode(ascii);
  } catch {
    return "";
  }
}
