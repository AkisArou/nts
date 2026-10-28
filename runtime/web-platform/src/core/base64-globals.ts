import {
  base64BinaryStringToBytes,
  base64BytesToBinaryString,
  forgivingBase64Decode,
  forgivingBase64Encode,
} from "./base64.ts";
import { DOMException } from "./errors.ts";
import { coerceToDOMString, requireArguments } from "./webidl.ts";

// HTML §8.3, Base64 utility methods. All byte/code-unit loops are in base64.ts,
// so a native replacement keeps this argument conversion and exception policy.
// Method definitions produce non-constructible callables without reflection.
// Provider bootstrap owns global installation and Window/Worker receiver checks.
const base64Utilities = {
  atob(data: unknown): string {
    requireArguments(arguments, 1, "atob");
    const input = base64BinaryStringToBytes(coerceToDOMString(data));
    const decoded = input === null ? null : forgivingBase64Decode(input);
    if (decoded === null) {
      throw new DOMException("The string is not valid base64", "InvalidCharacterError");
    }
    return base64BytesToBinaryString(decoded);
  },

  btoa(data: unknown): string {
    requireArguments(arguments, 1, "btoa");
    const input = base64BinaryStringToBytes(coerceToDOMString(data));
    if (input === null) {
      throw new DOMException("The string contains a character outside Latin-1", "InvalidCharacterError");
    }
    return forgivingBase64Encode(input);
  },
};

export const atob = base64Utilities.atob;
export const btoa = base64Utilities.btoa;
