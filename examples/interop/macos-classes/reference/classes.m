// The oracle: `src/main.ts` in Objective-C under ARC.
#import <Foundation/Foundation.h>
#include <objc/runtime.h>
#include <stdio.h>

static __weak id watched;

static void made(void) {
  NSObject *object = [[NSObject alloc] init];
  watched = object;
}

int main(void) {
  @autoreleasepool {
    NSMutableArray *list = [[NSMutableArray alloc] init];
    printf("empty %lu\n", (unsigned long)list.count);
    for (int n = 1; n <= 3; n++) [list addObject:[NSNumber numberWithInt:n]];
    printf("count %lu\n", (unsigned long)list.count);
    NSNumber *answer = [NSNumber numberWithInt:42];
    printf("number %d equal %s\n", answer.intValue, [answer isEqual:[NSNumber numberWithInt:42]] ? "true" : "false");
    printf("kinds %s %s %s\n", [answer isKindOfClass:[NSNumber class]] ? "true" : "false",
           [answer isKindOfClass:[NSString class]] ? "true" : "false", [list isKindOfClass:[NSObject class]] ? "true" : "false");
    printf("processors %s\n", NSProcessInfo.processInfo.processorCount > 0 ? "true" : "false");
    NSString *text = [[NSString alloc] initWithUTF8String:"worker"];
    printf("length %lu\n", (unsigned long)text.length);
    printf("upper %s\n", text.uppercaseString.UTF8String);
    NSOperation *operation = [[NSOperation alloc] init];
    operation.name = text;
    if (operation.name) printf("name %s\n", operation.name.UTF8String);
  }
  @autoreleasepool {
    made();
  }
  printf("object %s\n", watched ? "alive" : "gone");
  printf("done\n");
  return 0;
}
