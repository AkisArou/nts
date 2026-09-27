// The oracle: `src/main.ts`'s drawing, written against Core Graphics in C,
// printing the same lines. Colours are released as the TypeScript program's
// are, when nothing but the context's state holds them.
#include <CoreGraphics/CoreGraphics.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct objc_object *id;
id objc_initWeak(id *location, id value);
id objc_loadWeakRetained(id *location);
void objc_release(id value);

enum { WIDTH = 8, HEIGHT = 4 };

static id watch;

static double paint(CGContextRef context) {
  CGColorRef red = CGColorCreateGenericRGB(1, 0, 0, 1);
  objc_initWeak(&watch, (id)red);
  CGContextSetFillColorWithColor(context, red);
  CGContextFillRect(context, CGRectMake(0, 0, 4, 4));
  CGColorRelease(red);
  CGContextSetRGBFillColor(context, 0.5, 0.5, 0.5, 1);
  CGContextFillRect(context, CGRectMake(4, 0, 4, 2));
  CGColorRef blue = CGColorCreateGenericRGB(0, 0, 1, 0.5);
  CGContextSetFillColorWithColor(context, blue);
  CGContextFillEllipseInRect(context, CGRectMake(4, 2, 4, 2));
  CGContextClearRect(context, CGRectMake(0, 3, 1, 1));
  double alpha = CGColorGetAlpha(blue);
  CGColorRelease(blue);
  return alpha;
}

static void components(void) {
  CGFloat values[4] = {0.25, 0.5, 0.75, 1};
  CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
  CGColorRef color = CGColorCreate(space, values);
  CGColorSpaceRelease(space);
  const CGFloat *read = CGColorGetComponents(color);
  size_t count = CGColorGetNumberOfComponents(color);
  printf("components %zu", count);
  for (size_t at = 0; at < count; at++) printf(" %g", read[at]);
  printf("\n");
  CGColorRelease(color);
}

static void triangle(void) {
  enum { W = 4, H = 2 };
  unsigned char *pixels = calloc(W * H, 4);
  CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
  CGContextRef context = CGBitmapContextCreate(pixels, W, H, 8, W * 4, space, kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(space);
  CGContextSetRGBFillColor(context, 0, 1, 0, 1);
  CGContextMoveToPoint(context, 0, 0);
  CGContextAddLineToPoint(context, 4, 0);
  CGContextAddLineToPoint(context, 0, 2);
  CGContextClosePath(context);
  CGContextFillPath(context);
  for (int y = 0; y < H; y++) {
    printf("triangle %d", y);
    for (int x = 0; x < W; x++) {
      const unsigned char *pixel = pixels + (y * W + x) * 4;
      printf(" %02x%02x%02x%02x", pixel[0], pixel[1], pixel[2], pixel[3]);
    }
    printf("\n");
  }
  CGContextRelease(context);
  free(pixels);
}

static void paths(void) {
  CGPathRef oval = CGPathCreateWithEllipseInRect(CGRectMake(0, 0, 4, 2), NULL);
  CGPathRef box = CGPathCreateWithRect(CGRectMake(0, 0, 4, 2), NULL);
  CGPathRef copy = CGPathCreateCopy(oval);
  printf("paths %s %s\n", CGPathEqualToPath(oval, copy) ? "true" : "false", CGPathEqualToPath(oval, box) ? "true" : "false");
  CGPathRelease(copy);
  CGPathRelease(box);
  CGPathRelease(oval);
}

int main(void) {
  unsigned char *pixels = calloc(WIDTH * HEIGHT, 4);
  CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
  CGContextRef context = CGBitmapContextCreate(pixels, WIDTH, HEIGHT, 8, WIDTH * 4, space, kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(space);
  printf("size %zux%zu %zu\n", CGBitmapContextGetWidth(context), CGBitmapContextGetHeight(context),
         CGBitmapContextGetBytesPerRow(context));
  double alpha = paint(context);
  CGContextSetRGBFillColor(context, 0, 0, 0, 0);
  for (int y = 0; y < HEIGHT; y++) {
    printf("row %d", y);
    for (int x = 0; x < WIDTH; x++) {
      const unsigned char *pixel = pixels + (y * WIDTH + x) * 4;
      printf(" %02x%02x%02x%02x", pixel[0], pixel[1], pixel[2], pixel[3]);
    }
    printf("\n");
  }
  printf("alpha %g\n", alpha);
  id alive = objc_loadWeakRetained(&watch);
  printf("color %s\n", alive ? "alive" : "gone");
  if (alive) objc_release(alive);
  components();
  triangle();
  paths();
  printf("key a %s\n", CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, 0) ? "down" : "up");
  CGContextRelease(context);
  free(pixels);
  return 0;
}
