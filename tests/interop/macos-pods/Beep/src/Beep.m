#import "Beep.h"

@implementation Beep
+ (NSString *)beepTimes:(NSInteger)times {
  NSMutableArray<NSString *> *beeps = [NSMutableArray array];
  for (NSInteger i = 0; i < times; i++) [beeps addObject:@"beep"];
  return [beeps componentsJoinedByString:@"!"];
}
@end
