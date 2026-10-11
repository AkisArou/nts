interface OptionalOptions { readonly option?: string; }
interface RequiredOptions { readonly required: string; readonly option?: string; }
interface Address { readonly hostname: string; readonly port: number; }
interface Item { readonly value: number; }
interface Candidate { readonly item: Item; remove: boolean; }
class Options { readonly required = "present"; }
function option(value: OptionalOptions): string { return String(value.option); }
export function optionalOption(value: unknown): string { return option(value as OptionalOptions); }
export function requiredOption(value: unknown): string {
  return String((value as RequiredOptions).option);
}
export function requiredOptions(): RequiredOptions { return new Options(); }
export function candidates(values: Item[]): Candidate[] {
  return values.map(item => ({ item, remove: false }));
}
export function maybeAddress(n: number): Address | undefined {
  const value = { hostname: "local", port: n };
  if (n > 0) return value;
  return undefined;
}
