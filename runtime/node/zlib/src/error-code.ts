// The closed set of zlib status names. Keep internal error selection as static
// control flow; the bidirectional `codes` object in constants.ts exists only
// because it is part of Node's public API.

import {
  Z_BUF_ERROR,
  Z_DATA_ERROR,
  Z_ERRNO,
  Z_MEM_ERROR,
  Z_NEED_DICT,
  Z_OK,
  Z_STREAM_END,
  Z_STREAM_ERROR,
  Z_VERSION_ERROR,
} from "./constants.ts";

/** Return Node's zlib code name, or its fallback for an unknown native code. */
export function zlibCodeForStatus(status: number): string {
  switch (status) {
    case Z_OK: return "Z_OK";
    case Z_STREAM_END: return "Z_STREAM_END";
    case Z_NEED_DICT: return "Z_NEED_DICT";
    case Z_ERRNO: return "Z_ERRNO";
    case Z_STREAM_ERROR: return "Z_STREAM_ERROR";
    case Z_DATA_ERROR: return "Z_DATA_ERROR";
    case Z_MEM_ERROR: return "Z_MEM_ERROR";
    case Z_BUF_ERROR: return "Z_BUF_ERROR";
    case Z_VERSION_ERROR: return "Z_VERSION_ERROR";
    default: return "Z_UNKNOWN";
  }
}
