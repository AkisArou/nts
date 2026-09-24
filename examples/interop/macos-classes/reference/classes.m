// The oracle: `src/main.ts` in Objective-C under ARC.
#import <Foundation/Foundation.h>
#include <objc/runtime.h>
#include <stdio.h>

static __weak id watched;
static __weak id replaced;
static __weak id held;

/* Swift's `[NSNumber]`: the same operations on an NSMutableArray under ARC. */
static void arrays(void) {
  NSMutableArray<NSNumber *> *numbers = [@[ [NSNumber numberWithInt:1], [NSNumber numberWithInt:2] ] mutableCopy];
  [numbers addObject:[NSNumber numberWithInt:3]];
  NSArray<NSNumber *> *tail = [numbers subarrayWithRange:NSMakeRange(1, numbers.count - 1)];
  numbers[0] = [NSNumber numberWithInt:10];
  int total = 0;
  for (NSNumber *n in numbers) total += n.intValue;
  printf("arrays %lu %lu %d %d %lu\n", (unsigned long)numbers.count, (unsigned long)tail.count, total, tail[0].intValue,
         (unsigned long)[numbers indexOfObjectIdenticalTo:tail[1]]);
  NSMutableArray *objects = [NSMutableArray arrayWithObject:[[NSObject alloc] init]];
  replaced = objects[0];
  objects[0] = [[NSObject alloc] init];
  printf("replaced %s\n", replaced ? "alive" : "gone");
  held = objects[0];
}

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
    [list insertObject:[NSNumber numberWithInt:0] atIndex:0];
    printf("inserted %lu first %d\n", (unsigned long)list.count, ((NSNumber *)[list objectAtIndex:0]).intValue);
    NSNumber *answer = [NSNumber numberWithInt:42];
    printf("number %d equal %s\n", answer.intValue, [answer isEqual:[NSNumber numberWithInt:42]] ? "true" : "false");
    printf("kinds %s %s %s\n", [answer isKindOfClass:[NSNumber class]] ? "true" : "false",
           [answer isKindOfClass:[NSString class]] ? "true" : "false", [list isKindOfClass:[NSObject class]] ? "true" : "false");
    printf("processors %s\n", NSProcessInfo.processInfo.processorCount > 0 ? "true" : "false");
    NSString *text = [[NSString alloc] initWithUTF8String:"worker"];
    printf("length %lu\n", (unsigned long)text.length);
    printf("upper %s appended %s\n", text.uppercaseString.UTF8String, [text stringByAppendingString:@"!"].UTF8String);
    NSOperation *operation = [[NSOperation alloc] init];
    operation.name = @"worker";
    if (operation.name) printf("name %s %lu\n", operation.name.UTF8String, (unsigned long)operation.name.length);
    // Swift's `operation?.cancel()`, and the chain on nil, which Swift and
    // JavaScript both answer without a message.
    [operation cancel];
    printf("optional %s %s absent unnamed\n", operation.isCancelled ? "true" : "false", operation.name.UTF8String);
  }
  @autoreleasepool {
    arrays();
  }
  printf("array %s\n", held ? "alive" : "gone");
  @autoreleasepool {
    made();
  }
  printf("object %s\n", watched ? "alive" : "gone");
  printf("done\n");
  return 0;
}
