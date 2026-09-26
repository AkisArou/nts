// Records by value through Objective-C: sent as arguments, returned from
// sends, and through a Foundation C function. Checked against the same
// program in Objective-C (`reference/geometry.m`).
//
// `rectValue` is the case that decides x86_64's entry point: a 32-byte result
// comes back through `objc_msgSend_stret`, and sending it through
// `objc_msgSend` would read the receiver where the hidden result pointer is.
import { NSIntersectionRect, valueWithPoint, valueWithRect, type CGPoint, type CGRect } from "objc:Foundation";
import { local } from "c:memory";
import type { Ptr, c_double } from "c:types";

// Fills storage the caller owns: returning a `local` would be its address
// escaping the frame that owns it, which is refused.
function setRect(r: Ptr<CGRect>, x: number, y: number, width: number, height: number): void {
  r.origin.x = x as c_double;
  r.origin.y = y as c_double;
  r.size.width = width as c_double;
  r.size.height = height as c_double;
}

function main(): void {
  const a = local<CGRect>();
  const b = local<CGRect>();
  setRect(a, 0, 0, 10, 10);
  setRect(b, 5, 2.5, 10, 10);
  const i = NSIntersectionRect(a, b);
  console.log(`intersection ${i.origin.x} ${i.origin.y} ${i.size.width} ${i.size.height}`);

  const boxed = valueWithRect(b);
  const back = boxed.rectValue();
  console.log(`rect ${back.origin.x} ${back.origin.y} ${back.size.width} ${back.size.height}`);
  // The result is its own storage.
  b.size.width = 99 as c_double;
  console.log(`kept ${back.size.width}`);

  const p = local<CGPoint>();
  p.x = 3.5 as c_double;
  p.y = -1 as c_double;
  const q = valueWithPoint(p).pointValue();
  console.log(`point ${q.x} ${q.y}`);
}

main();
