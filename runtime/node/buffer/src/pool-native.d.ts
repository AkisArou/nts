// Native operations used by Node v26.13.0's Buffer slab allocator.
/** @ntsAbi managed */
declare function nts_buffer_create_unsafe_array_buffer(size: number): ArrayBuffer;
/** @ntsAbi managed */
declare function nts_buffer_array_buffer_aligned_offset(buffer: ArrayBuffer, alignment: number): number;
// The native ArrayBuffer owns the mark; every view sees the same state.
/** @ntsAbi managed */
declare function nts_buffer_mark_as_untransferable(buffer: ArrayBuffer): void;

// One allocation operation carries both pieces of the alignment result.
interface BufferAlignedAllocation {
  buffer: ArrayBuffer;
  byteOffset: number;
}
/** @ntsAbi managed */
declare function nts_buffer_allocate_aligned(size: number, alignment: number): BufferAlignedAllocation;
