// Shared Web-platform source compiled and executed by NTS.
//
// Everything else in this lane is host evidence: TypeScript running on node, which
// says the algorithms are right and nothing about whether they compile. This is the
// other axis, and it started at zero.
//
// What is here is what currently compiles. Modules reachable only through the wider
// import graph pull in the whole runtime and its 1,300 refusals, so the frontier is
// not a judgement about which code matters -- it is a measurement of where the
// compiler is, and it should grow as prerequisites land rather than by being
// rewritten to fit.
//
// `nts check` generates cases, runs them compiled, runs them on the oracle and
// compares. Agreement here is compiled-provider evidence for the backend it ran on.

import {
  certificateCovers,
  dnsNameCovers,
} from "../../../../../runtime/web-platform/src/http/certificate.ts";
import {
  isASCIIWhitespace,
  trimHTTPTabOrSpace,
} from "../../../../../runtime/web-platform/src/core/ascii.ts";
import { forgivingBase64Decode } from "../../../../../runtime/web-platform/src/core/base64.ts";
import { percentDecodeBytes } from "../../../../../runtime/web-platform/src/core/percent.ts";

/** dNSName matching, including the wildcard rules HTTP/2 coalescing depends on. */
export function covers(presented: string, host: string): boolean {
  return dnsNameCovers(presented, host);
}

export function coveredByAny(host: string): boolean {
  return certificateCovers(["a.test", "*.b.test"], host);
}

/** The ASCII whitespace predicate the integrity and header parsers tokenize with. */
export function whitespace(code: number): boolean {
  return isASCIIWhitespace(code);
}

export function trimmed(value: string): string {
  return trimHTTPTabOrSpace(value);
}

/** Infra's forgiving base64, which subresource integrity compares digests through. */
export function base64Length(input: string): number {
  const bytes = new Uint8Array(input.length);
  for (let index = 0; index < input.length; index++) {
    bytes[index] = input.charCodeAt(index) & 0xff;
  }
  const decoded = forgivingBase64Decode(bytes);
  return decoded === null ? -1 : decoded.length;
}

/** Percent decoding, reported as a length so the result stays scalar. */
export function percentDecodedLength(input: string): number {
  return percentDecodeBytes(input).length;
}
