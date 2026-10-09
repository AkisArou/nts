// Hand-written: Foundation's geometry, checked by hand against the SDK's
// CGGeometry.h, NSGeometry.h and NSValue.h. `CGFloat` is `double` on every
// 64-bit Apple target, and `NSRect` is `CGRect`.
/**
 * @ntsFramework Foundation
 */
declare module "objc:Foundation" {
  import type { ByValue, Struct } from "c:types";
  import type { Float64 } from "@nts/scalars";
  import type { ObjcClass } from "objc:types";

  export type CGPoint = Struct<{ x: Float64; y: Float64 }, "CGPoint">;
  export type CGSize = Struct<{ width: Float64; height: Float64 }, "CGSize">;
  export type CGRect = Struct<{ origin: CGPoint; size: CGSize }, "CGRect">;

  export interface NSValueOwnMethods {
    /**
     * A 32-byte record returned: on x86_64 through `objc_msgSend_stret`.
     * @ntsSelector rectValue
     */
    rectValue(this: NSValue): ByValue<CGRect>;
    /**
     * A 16-byte record returned, in two registers.
     * @ntsSelector pointValue
     */
    pointValue(this: NSValue): ByValue<CGPoint>;
  }
  export type NSValue = ObjcClass<"NSValue"> & NSValueOwnMethods;

  /**
   * @ntsSelector valueWithRect:
   * @ntsClass NSValue
   */
  export function valueWithRect(rect: ByValue<CGRect>): NSValue;
  /**
   * @ntsSelector valueWithPoint:
   * @ntsClass NSValue
   */
  export function valueWithPoint(point: ByValue<CGPoint>): NSValue;

  /** A C function taking and returning records by value. */
  export function NSIntersectionRect(a: ByValue<CGRect>, b: ByValue<CGRect>): ByValue<CGRect>;
}
