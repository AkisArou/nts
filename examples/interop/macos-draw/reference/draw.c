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
  CGContextRelease(context);
  free(pixels);
  return 0;
}
