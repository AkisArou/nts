import { accept_name, ATOM } from "c:resource-overload-probe";
export function atomCall(): number { return accept_name(ATOM); }
export function textCall(): number { return accept_name("A"); }
export function wideCall(): number { return accept_name("\u0394"); }
export function surrogateCall(): number { return accept_name(String.fromCharCode(0xD83D)); }
export function typeUtilityCall(): number {
  const text: Parameters<typeof accept_name>[0] = "B";
  return accept_name(text);
}
