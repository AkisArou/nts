#import "Tweeter.h"

@implementation Tweeter
+ (NSString *)noteRepeated:(NSInteger)count {
  NSMutableArray<NSString *> *notes = [NSMutableArray array];
  for (NSInteger i = 0; i < count; i++) {
    [notes addObject:@"tweet"];
  }
  return [notes componentsJoinedByString:@" "];
}
@end
