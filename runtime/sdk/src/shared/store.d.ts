/**
 * @nts/sdk/store — app-store presence: asking for a review, linking to
 * the listing. Anything richer (in-app purchases, subscriptions) is a
 * billing system with its own design round, deliberately not started
 * here; native projections expose StoreKit/Play Billing meanwhile.
 */
import type { Availability } from "./core.d.ts";

export interface Store {
  availability(): Promise<Availability>;
  /**
   * Asks the OS to show its review prompt. The OS decides whether
   * anything appears (rate limits, user settings) — resolves true when
   * the request was accepted, which is not a promise a prompt showed.
   */
  requestReview(): Promise<boolean>;
  /** Opens this app's store listing (optionally another product's by id). */
  openListing(productId?: string): Promise<boolean>;
}

export declare const store: Store;
