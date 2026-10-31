// Native operations used by Node v26.13.0's Buffer slab allocator.
/** @ntsAbi managed */
declare function nts_buffer_create_unsafe_array_buffer(size: number): ArrayBuffer;
/** @ntsAbi managed */
declare function nts_buffer_array_buffer_aligned_offset(buffer: ArrayBuffer, alignment: number): number;
// Compiled agent/detach-key support is still required for this operation.
// Deliberately no no-op C stand-in: an unmarked slab would permit detachment.
/** @ntsAbi managed */
declare function nts_buffer_mark_as_untransferable(buffer: ArrayBuffer): void;
