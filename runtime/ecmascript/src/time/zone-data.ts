// Provider data capability; no identifier or public builtin algorithms.
export interface TimeZoneIdentifierData {
  timeZoneNames(): string[];
  canonicalTimeZone(name: string): string | undefined;
  defaultTimeZoneIdentifier(): string;
}
