declare module "c:report" {
  import type { c_uint } from "c:types";
  export function report(line: string): void;
  // How many runtime classes the Windows Runtime has activated so far.
  export function activations(): c_uint;
  // How many COM references the program has released so far.
  export function releases(): c_uint;
  // Whether the program was run with `word` as its first argument.
  export function asked(word: string): boolean;
  // How many delegates the program made are still alive.
  export function delegates(): c_uint;
  // Calls `handler` with `sender` on a thread of its own after 100 ms, and
  // releases both there 300 ms later.
  export function invoke_elsewhere(
    handler: import("winrt:types").Delegate<(sender: import("winrt:Windows.Data.Json").IJsonValue) => void, "4E7A1D30-6B2C-4F0E-9A51-3C8D2B7E1F60">,
    sender: import("winrt:Windows.Data.Json").IJsonValue,
  ): void;
}
