/**
 * @nts/sdk/compose — the OS mail/SMS composers.
 * `linking.open("mailto:…")` covers the trivial case, badly: no
 * attachments, no result, and no idea whether a handler exists. Where
 * the platform has a composer sheet, this presents it and reports the
 * outcome. Where it doesn't (most desktops), availability says so and
 * apps fall back to `mailto:`/`sms:` links.
 */
import type { Availability, SignalOptions } from "./core.d.ts";

export interface MailMessage {
  readonly to?: readonly string[];
  readonly cc?: readonly string[];
  readonly bcc?: readonly string[];
  readonly subject?: string;
  /** Plain text, or HTML when `html` is true. */
  readonly body?: string;
  readonly html?: boolean;
  readonly attachments?: readonly File[];
}

export interface TextMessage {
  readonly to: readonly string[];
  readonly body?: string;
  readonly attachments?: readonly File[];
}

/** What the user did with the sheet — as reported by the OS, where reported. */
export type ComposeResult = "sent" | "saved" | "cancelled" | "unknown";

export interface Compose {
  mailAvailable(): Promise<Availability>;
  smsAvailable(): Promise<Availability>;
  mail(message: MailMessage, options?: SignalOptions): Promise<ComposeResult>;
  sms(message: TextMessage, options?: SignalOptions): Promise<ComposeResult>;
}

export declare const compose: Compose;
