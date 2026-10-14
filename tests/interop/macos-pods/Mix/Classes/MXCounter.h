#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// The pod's Objective-C half: a counter its Swift half counts with.
@interface MXCounter : NSObject
- (NSInteger)next;
/// Its count, as the pod's Swift half words it.
- (NSString *)summary;
@end

NS_ASSUME_NONNULL_END
