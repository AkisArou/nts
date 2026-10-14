// A framework shipped as a binary: its headers are its API.
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface Beep : NSObject
+ (NSString *)beepTimes:(NSInteger)times;
@end

NS_ASSUME_NONNULL_END
