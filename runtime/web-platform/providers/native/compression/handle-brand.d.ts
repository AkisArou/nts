declare const nativeCompressionHandle: unique symbol;
export interface NativeCompressionBrand {
  readonly [nativeCompressionHandle]: never;
}
