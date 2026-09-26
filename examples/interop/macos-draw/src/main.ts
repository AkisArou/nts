// Core Graphics from TypeScript, as Swift imports it: `CGContextRef` is a
// class, `CGContext`, whose methods are the C functions that take one --
// `context.fill(rect)` is `CGContextFillRect` -- and whose initializers are
// its name, `CGColor({ red, green, blue, alpha })`. Drawn into memory the
// program owns, and read back a pixel at a time.
//
// What it checks, against `reference/draw.c`, the same drawing in C:
//
//   size 8x4 32   a bitmap context's properties, read through the functions
//                 Swift reads them through (`CGBitmapContextGetWidth`)
//   row 0..3      every pixel: a red rectangle, a gray one written as a
//                 rectangle's fields, a blue ellipse, one cleared pixel, and
//                 the same colour set both ways Swift offers (a `CGColor`,
//                 and its components as labels)
//   alpha 0.5     a colour's property
//   color gone    the colours this program made, released: a `Create`
//                 function hands over a reference, which the program owns
import { CGColor, CGColorSpaceCreateDeviceRGB, CGContext, CGImageAlphaInfo } from "objc:CoreGraphics";
import { weak_alive, weak_watch } from "c:support";
import { malloc } from "c:stdlib";
import type { Ptr, c_int, c_uint8 } from "c:types";

const WIDTH = 8;
const HEIGHT = 4;

function row(pixels: Ptr<c_uint8>, y: number): string {
  let text = "";
  for (let x = 0; x < WIDTH; x++) {
    const at = (y * WIDTH + x) * 4;
    let pixel = "";
    for (let channel = 0; channel < 4; channel++) {
      pixel += pixels[at + channel].toString(16).padStart(2, "0");
    }
    text += x === 0 ? pixel : ` ${pixel}`;
  }
  return text;
}

let watch = 0 as c_int;

// The colours, made and dropped here: once this returns, nothing holds them
// but the context's own state, which a later colour replaces.
function paint(context: CGContext): string {
  const red = CGColor({ red: 1, green: 0, blue: 0, alpha: 1 });
  watch = weak_watch(red);
  context.setFillColor(red);
  context.fill({ size: { width: 4, height: 4 } });
  // A rectangle's fields, held in a variable and read at the call.
  const band = { origin: { x: 4, y: 0 }, size: { width: 4, height: 2 } };
  context.setFillColor({ red: 0.5, green: 0.5, blue: 0.5, alpha: 1 });
  context.fill(band);
  const blue = CGColor({ red: 0, green: 0, blue: 1, alpha: 0.5 });
  context.setFillColor(blue);
  context.fillEllipse({ in: { origin: { x: 4, y: 2 }, size: { width: 4, height: 2 } } });
  context.clear({ origin: { x: 0, y: 3 }, size: { width: 1, height: 1 } });
  return `alpha ${blue.alpha}`;
}

function main(): void {
  const pixels = malloc<c_uint8>(WIDTH * HEIGHT * 4);
  if (pixels === null) {
    return;
  }
  for (let at = 0; at < WIDTH * HEIGHT * 4; at++) {
    pixels[at] = 0 as c_uint8;
  }
  const context = CGContext({
    data: pixels,
    width: WIDTH,
    height: HEIGHT,
    bitsPerComponent: 8,
    bytesPerRow: WIDTH * 4,
    space: CGColorSpaceCreateDeviceRGB(),
    // Swift's `CGImageAlphaInfo.premultipliedLast.rawValue`.
    bitmapInfo: CGImageAlphaInfo.premultipliedLast as number,
  });
  console.log(`size ${context.width}x${context.height} ${context.bytesPerRow}`);
  const alpha = paint(context);
  // A later colour replaces the one the context's state held.
  context.setFillColor({ red: 0, green: 0, blue: 0, alpha: 0 });
  for (let y = 0; y < HEIGHT; y++) {
    console.log(`row ${y} ${row(pixels, y)}`);
  }
  console.log(alpha);
  console.log(`color ${weak_alive(watch) ? "alive" : "gone"}`);
}

main();
