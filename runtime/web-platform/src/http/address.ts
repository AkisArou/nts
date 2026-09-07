import type { ConnectAddress, URLRecord } from "../provider/primitives.ts";

/** Convert a parsed network URL to the provider-neutral socket boundary. */
export function addressOf(url: URLRecord, connectTimeoutMs: number): ConnectAddress {
  const secure = url.protocol === "https:" || url.protocol === "wss:";
  const hostname =
    url.hostname.startsWith("[") && url.hostname.endsWith("]")
      ? url.hostname.slice(1, -1)
      : url.hostname;
  return {
    hostname,
    port: url.port === "" ? (secure ? 443 : 80) : Number(url.port),
    secure,
    connectTimeoutMs,
  };
}
