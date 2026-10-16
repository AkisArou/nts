/**
 * @nts/sdk/printing — putting content on paper.
 * Browsers print the document (`window.print`); a native app prints
 * content it has — overwhelmingly a PDF it generated or received.
 * So the contract is: hand the OS a document, it shows its print UI.
 * Rich print *layout* belongs to whatever produced the PDF.
 */
import type { Availability, SignalOptions } from "./core.d.ts";

export interface PrintOptions extends SignalOptions {
  readonly jobName?: string;
  readonly copies?: number;
  readonly orientation?: "portrait" | "landscape";
  readonly duplex?: boolean;
  /** Present the OS print dialog. Default true; false = direct print where allowed (desktop/kiosk). */
  readonly dialog?: boolean;
}

export type PrintResult = "printed" | "cancelled";

export interface Printer {
  readonly id: string;
  readonly name: string;
  readonly url?: string;
}

export interface Printing {
  availability(): Promise<Availability>;
  /** PDF and image Files are the portable input. */
  print(document: File | Blob, options?: PrintOptions & { readonly printer?: Printer }): Promise<PrintResult>;
  /**
   * Renders HTML to a PDF File without printing it. Requires an HTML
   * engine: meaningful on Blink/mobile-webview hosts; rejects
   * `unsupported` in pure native hosts without one.
   */
  toPdf(html: string, options?: SignalOptions & { readonly width?: number; readonly height?: number }): Promise<File>;
  /** Known printers, primarly desktop/AirPrint. Empty where unlistable. */
  printers(): Promise<readonly Printer[]>;
}

export declare const printing: Printing;
