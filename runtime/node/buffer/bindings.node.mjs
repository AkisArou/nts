// Host equivalents of the Buffer allocator's native primitives. No private
// Node loader or process.binding call is needed.
import "../internal/bindings.node.mjs";
import { Buffer as HostBuffer } from "node:buffer";
import { markAsUntransferable } from "node:worker_threads";

// Keep Node's alignment witness for the unmodified upstream address-observer
// test. An alignment witness for A also proves every power-of-two divisor of A.
// Never invent an address for a backing store this adapter did not allocate.
const alignmentWitnesses = new WeakMap();
globalThis.nts_buffer_create_unsafe_array_buffer = (size) => {
  const buffer = HostBuffer.allocUnsafeSlow(size).buffer;
  alignmentWitnesses.set(buffer, { alignment: 8, byteOffset: 0 });
  return buffer;
};
globalThis.nts_buffer_allocate_aligned = (size, alignment) => {
  const view = HostBuffer.allocUnsafeSlow(size, alignment);
  const { buffer, byteOffset } = view;
  alignmentWitnesses.set(buffer, { alignment, byteOffset });
  return { buffer, byteOffset };
};
globalThis.nts_buffer_array_buffer_aligned_offset = (buffer, alignment) => {
  const witness = alignmentWitnesses.get(buffer);
  if (witness === undefined || alignment > witness.alignment || alignment < 1 ||
      (alignment & (alignment - 1)) !== 0) {
    throw new Error("no public alignment witness for this backing store");
  }
  return witness.byteOffset & (alignment - 1);
};
globalThis.nts_buffer_mark_as_untransferable = (buffer) => markAsUntransferable(buffer);
