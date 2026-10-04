// Provider data capability; no identifier or public builtin algorithms.
import type { TimeZoneRules } from "./provider.ts";

// Shared identifier resolution adds JS identity to a provider rule snapshot.
// The requested spelling and IANA primary identity need not be ICU's older
// canonical name. Offset identifiers remain distinct from named UTC aliases.
export interface ResolvedTimeZone extends TimeZoneRules {
  readonly primaryId: string;
}

// An injected environment capability. Pure ISO/UTC values do not own a host
// environment, and shared algorithms do not import a concrete ICU provider.
export interface TimeZoneSource {
  resolveNamed(identifier: string): ResolvedTimeZone;
}

export interface TimeZoneIdentifierData {
  timeZoneNames(): string[];
  canonicalTimeZone(name: string): string | undefined;
  // IANA primary identity differs from CLDR's older canonical spelling.
  primaryTimeZone(name: string): string | undefined;
  primaryTimeZoneNames(): string[];
  defaultTimeZoneIdentifier(): string;
}
