interface Item { readonly value: number; }
interface Candidate { readonly item: Item; remove: boolean; }
interface Address { readonly hostname: string; readonly port: number; }
export function addresses(values: number[]): Address[] {
  return values.map(port => ({ hostname: "local", port }));
}
export function candidates(values: Item[]): Candidate[] {
  return values.map(item => ({ item, remove: false }));
}
