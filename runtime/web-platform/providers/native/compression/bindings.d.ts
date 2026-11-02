/** @ntsHeader nts_web_compression.h */
declare module "c:nts_web_compression" {
  export type NativeCompressionHandle = import("./handle.ts").NativeCompressionHandle;
  /** @ntsAbi managed
   * @ntsLibrary brotli
   * @ntsLibrary zlib
   */
  export function nts_web_compression_open(format: number, decompress: boolean,
    windowBits: number): NativeCompressionHandle | null;
  /** @ntsAbi managed
   * @ntsLibrary brotli
   * @ntsLibrary zlib
   */
  export function nts_web_compression_process(context: NativeCompressionHandle,
    input: Uint8Array, flush: number, maximum: number): Uint8Array[];
  /** @ntsAbi managed
   * @ntsLibrary brotli
   * @ntsLibrary zlib
   */
  export function nts_web_compression_status(context: NativeCompressionHandle): number;
  /** @ntsAbi managed
   * @ntsLibrary brotli
   * @ntsLibrary zlib
   */
  export function nts_web_compression_consumed(context: NativeCompressionHandle): number;
  /** @ntsAbi managed
   * @ntsLibrary brotli
   * @ntsLibrary zlib
   */
  export function nts_web_compression_reset(context: NativeCompressionHandle): boolean;
  /** @ntsAbi managed
   * @ntsLibrary brotli
   * @ntsLibrary zlib
   */
  export function nts_web_compression_close(context: NativeCompressionHandle): void;
}
