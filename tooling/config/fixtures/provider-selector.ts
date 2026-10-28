import type { ProviderSelector } from "../src/profiles.ts";

/** An explicit instance disambiguates two copies of the same provider package.
 * The Rust schema control reads this fixture, including its recorded options.
 */
export default {
  use: "@nts/source",
  instance: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  options: { mode: "verified" },
} satisfies ProviderSelector;
