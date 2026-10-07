// A host module whose functions answer promises the host settles later.
declare module "host:later" {
  /** @ntsSymbol host_later */
  export function later(): Promise<void>;
}
