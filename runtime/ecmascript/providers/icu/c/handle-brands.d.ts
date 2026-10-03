// Type-only provenance markers: neither is part of the native payload.
declare const timeZoneHandle: unique symbol;
declare const numberHandle: unique symbol;
export interface TimeZoneHandleBrand {
  readonly [timeZoneHandle]: never;
}
export interface NumberHandleBrand {
  readonly [numberHandle]: never;
}
