// The native half of `node:buffer`, for the node-side run only.
//
// Nothing of its own: what it needs is the shared process-level bindings that
// the code under `internal/` declares.
import "../internal/bindings.node.mjs";

import { markAsUntransferable } from "node:worker_threads";
const bufferBinding = process.binding("buffer");
globalThis.nts_buffer_create_unsafe_array_buffer = (size) =>
  bufferBinding.createUnsafeArrayBuffer(size);
globalThis.nts_buffer_array_buffer_aligned_offset = (buffer, alignment) =>
  bufferBinding.arrayBufferAlignedOffset(buffer, alignment);
globalThis.nts_buffer_mark_as_untransferable = (buffer) => markAsUntransferable(buffer);
