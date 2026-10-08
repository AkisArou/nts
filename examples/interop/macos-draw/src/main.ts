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
//   components    a colour made from a buffer of components, a `const
//                 CGFloat *`, and read back through the pointer Swift hides
//                 behind its `components` array (`__unsafeComponents`)
//   triangle 0..1 a path traced point by point, `CGContextMoveToPoint` and
//                 `CGContextAddLineToPoint`, which Swift refines into
//                 `move(to:)` and `addLine(to:)` and which bind under the
//                 names the refinement hides: `moveTo`, `addLineTo`
//   paths         two paths compared, `CGPathEqualToPath(path1, path2)`,
//                 whose receiver is the parameter Swift does not name
//   key a up      a class method of a Core Foundation type,
//                 `CGEventSource.keyState(_:key:)`
import { CGColor, CGColorSpaceCreateDeviceRGB, CGContext, CGEventSource, CGEventSourceStateID, CGImageAlphaInfo, CGPath } from "objc:CoreGraphics";
import { weak_alive, weak_watch } from "c:support";
import { free, malloc } from "c:stdlib";
import type { Ptr, c_int, c_uint8 } from "c:types";
import type { CGFloat } from "objc:types";

const WIDTH = 8;
const HEIGHT = 4;

function row(pixels: Ptr<c_uint8>, y: number, width: number): string {
  let text = "";
  for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    let pixel = "";
    for (let channel = 0; channel < 4; channel++) {
      pixel += pixels[at + channel].toString(16).padStart(2, "0");
    }
    text += x === 0 ? pixel : ` ${pixel}`;
  }
  return text;
}

let watch: c_int = 0 as c_int;

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

function components(): string {
  const values = malloc<CGFloat>(4 * 8);
  if (values === null) {
    return "components none";
  }
  values[0] = 0.25;
  values[1] = 0.5;
  values[2] = 0.75;
  values[3] = 1;
  const color = CGColor({ colorSpace: CGColorSpaceCreateDeviceRGB(), components: values });
  free(values);
  const read = color.unsafeComponents;
  if (read === null) {
    return "components none";
  }
  let text = `components ${color.numberOfComponents}`;
  for (let at = 0; at < color.numberOfComponents; at++) {
    text += ` ${read[at]}`;
  }
  return text;
}

function triangle(): void {
  const width = 4;
  const height = 2;
  const pixels = malloc<c_uint8>(width * height * 4);
  if (pixels === null) {
    return;
  }
  for (let at = 0; at < width * height * 4; at++) {
    pixels[at] = 0 as c_uint8;
  }
  const context = CGContext({
    data: pixels,
    width,
    height,
    bitsPerComponent: 8,
    bytesPerRow: width * 4,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast as number,
  });
  context.setFillColor({ red: 0, green: 1, blue: 0, alpha: 1 });
  context.moveTo({ x: 0, y: 0 });
  context.addLineTo({ x: 4, y: 0 });
  context.addLineTo({ x: 0, y: 2 });
  context.closePath();
  context.fillPath();
  for (let y = 0; y < height; y++) {
    console.log(`triangle ${y} ${row(pixels, y, width)}`);
  }
  free(pixels);
}

function paths(): string {
  const oval = CGPath({ ellipseIn: { size: { width: 4, height: 2 } }, transform: null });
  const box = CGPath({ rect: { size: { width: 4, height: 2 } }, transform: null });
  return `paths ${oval.equalTo(oval.copy())} ${oval.equalTo(box)}`;
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
    console.log(`row ${y} ${row(pixels, y, WIDTH)}`);
  }
  console.log(alpha);
  console.log(`color ${weak_alive(watch) ? "alive" : "gone"}`);
  console.log(components());
  triangle();
  console.log(paths());
  const down = CGEventSource.keyState(CGEventSourceStateID.combinedSessionState, { key: 0 });
  console.log(`key a ${down ? "down" : "up"}`);
}

main();
