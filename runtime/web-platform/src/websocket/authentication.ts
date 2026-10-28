import { decodeUTF8 } from "../core/encoding.ts";
import { percentDecodeBytes } from "../core/percent.ts";
import { parseChallenges } from "../dispatch/authenticate.ts";
import { basicAuthorization } from "../dispatch/proxy.ts";
import type { HeaderEntry } from "../fetch/headers.ts";
import type { URLRecord } from "../provider/primitives.ts";

/** RFC 6455 §4.1 response step 1 and RFC 7617 §2: answer an origin Basic challenge. */
export function webSocketBasicAuthorization(
  url: URLRecord,
  status: number,
  headers: readonly HeaderEntry[],
): string | null {
  if (status !== 401 || (url.username === "" && url.password === "")) return null;
  for (const [name, value] of headers) {
    if (name.toLowerCase() !== "www-authenticate") continue;
    for (const challenge of parseChallenges(value)) {
      if (challenge.scheme !== "basic") continue;
      // Match the existing proxy userinfo policy: percent-decode once, preserve
      // literal '+', and reject invalid UTF-8 rather than changing credentials.
      return basicAuthorization(
        decodeUTF8(percentDecodeBytes(url.username), true, true),
        decodeUTF8(percentDecodeBytes(url.password), true, true),
      );
    }
  }
  return null;
}
