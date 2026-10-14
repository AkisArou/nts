/** @ntsHeader "host.h" */
declare module "host" {
  /** A string of a fixed shape, as lib.dom's `crypto.randomUUID()` declares. */
  export function make_id(): `${string}-${string}`;
}
