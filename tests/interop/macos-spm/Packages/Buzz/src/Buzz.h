#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// A package that ships only a binary, downloaded by `url:`.
@interface Buzz : NSObject
+ (NSString *)buzzTimes:(NSInteger)times;
@end

NS_ASSUME_NONNULL_END
