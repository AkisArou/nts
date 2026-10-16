/**
 * @nts/sdk/network — connectivity as the app experiences it.
 *
 * Standard parts (use directly): `fetch` for traffic;
 * `navigator.connection` (Network Information) for the browser-shaped
 * estimates; `navigator.onLine` for the coarse hint.
 * SDK part: reachability *state* as an observable value (the thing apps
 * actually branch on), and cellular facts the Web API deliberately omits.
 * Permission note: fine-grained cellular/radio identity is restricted on
 * mobile OSes; fields are optional because the OS may withhold them.
 */
import type { Availability, SignalOptions, Watch } from "./core.d.ts";

/** Re-exported so `@nts/sdk/network` is self-describing in the API reference. */
export type NetworkInformation = globalThis.NetworkInformation;

export type NetworkType = "wifi" | "cellular" | "ethernet" | "vpn" | "other" | "none" | "unknown";

export interface NetworkState {
  readonly online: boolean;
  /** Internet actually reachable (not just link-up), where the OS probes it. */
  readonly internetReachable?: boolean;
  readonly airplaneMode?: boolean;
  readonly type: NetworkType;
  /** The OS considers this connection metered/expensive. */
  readonly metered?: boolean;
  readonly cellular?: {
    /** "2g" | "3g" | "4g" | "5g" as the OS reports generation. */
    readonly generation?: string;
    readonly carrier?: string;
    /** ISO country code from the SIM/network, where exposed. */
    readonly countryCode?: string;
    readonly roaming?: boolean;
    readonly mobileCountryCode?: string;
    readonly mobileNetworkCode?: string;
    readonly allowsVoip?: boolean;
  };
  readonly wifi?: {
    /** SSID is location-sensitive on mobile; present only where the OS allows. */
    readonly ssid?: string;
    /** Signal strength 0..1, where reported. */
    readonly strength?: number;
  };
}

export interface Network {
  availability(): Promise<Availability>;
  state(): Promise<NetworkState>;
  /** `await using w = await network.watch(); for await (const s of w) …` */
  watch(options?: SignalOptions): Promise<Watch<NetworkState>>;
  /** Local IPv4 address of the active interface, where exposed (never a public-IP lookup). */
  ipAddress(): Promise<string | undefined>;
}

export declare const network: Network;
