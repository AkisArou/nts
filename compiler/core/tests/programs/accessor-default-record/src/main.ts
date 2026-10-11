interface OptionalOptions { readonly option?: string; }
interface Address { readonly hostname: string; readonly port: number; }
function option(value: OptionalOptions): string { return String(value.option); }
export function optionalOption(value: unknown): string { return option(value as OptionalOptions); }
export function maybeAddress(n: number): Address | undefined {
  const value = { hostname: "local", port: n };
  if (n > 0) return value;
  return undefined;
}
