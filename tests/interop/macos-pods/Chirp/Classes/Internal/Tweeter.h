// Private to the pod: not in its public headers, and not bound.
#import <Foundation/Foundation.h>

@interface Tweeter : NSObject
+ (NSString *)noteRepeated:(NSInteger)count;
@end
