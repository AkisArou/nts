// The oracle: `src/main.ts` in Objective-C under ARC.
#import <Foundation/Foundation.h>
#include <objc/runtime.h>
#include <stdio.h>

static __weak id watched;

/* Swift's `class Elements: NSObject, XMLParserDelegate`. */
@interface Elements : NSObject <NSXMLParserDelegate>
@property NSMutableString *names;
@end
@implementation Elements
- (void)parser:(NSXMLParser *)parser didStartElement:(NSString *)name namespaceURI:(NSString *)uri qualifiedName:(NSString *)qname attributes:(NSDictionary *)attributes {
  if (!self.names) self.names = [NSMutableString string];
  if (self.names.length) [self.names appendString:@","];
  [self.names appendString:name];
}
@end
/* Swift's `class Tally: NSObject { var count = 0 ... }`: stored properties,
 * which `init` sets and ARC gives back with the object. */
@interface Tally : NSObject
@property NSInteger count;
@property NSInteger step;
@property NSString *label;
@property NSMutableArray<NSString *> *names;
@end
@implementation Tally
- (instancetype)init {
  if ((self = [super init])) {
    _count = 0;
    _step = 2;
    _label = @"tally";
    _names = [[NSMutableArray alloc] init];
  }
  return self;
}
- (void)bump { self.count += self.step; }
- (NSInteger)total { return self.count; }
@end
static __weak id tallyWatch;

static NSString *tallied(void) {
  Tally *tally = [[Tally alloc] init];
  tallyWatch = tally;
  [tally bump];
  tally.step = 4;
  [tally bump];
  [tally.names addObject:@"x"];
  [tally.names addObject:@"y"];
  tally.label = @"total";
  return [NSString stringWithFormat:@"%@ %ld %ld %@", tally.label, (long)[tally total], (long)tally.count,
                                    [tally.names componentsJoinedByString:@","]];
}

@interface Ledger : NSObject
@property NSString *owner;
@property NSInteger balance;
@property NSInteger entries;
- (instancetype)initWithOwner:(NSString *)owner opening:(NSInteger)opening;
- (void)record:(NSInteger)amount;
+ (NSString *)described;
@end
static NSInteger ledgersOpened;
@implementation Ledger
- (instancetype)initWithOwner:(NSString *)owner opening:(NSInteger)opening {
  if ((self = [super init])) {
    ledgersOpened++;
    _owner = owner;
    _balance = 0;
    _entries = 0;
    [self record:opening];
  }
  return self;
}
- (void)record:(NSInteger)amount {
  self.balance += amount;
  self.entries++;
}
+ (NSString *)described {
  return [NSString stringWithFormat:@"%ld opened", (long)ledgersOpened];
}
@end
static __weak id ledgerWatch;

static NSString *ledgered(void) {
  Ledger *ledger = [[Ledger alloc] initWithOwner:@"ada" opening:10];
  ledgerWatch = ledger;
  [ledger record:5];
  return [NSString stringWithFormat:@"%@ %ld %ld", ledger.owner, (long)ledger.balance, (long)ledger.entries];
}

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
    [list sortUsingComparator:^NSComparisonResult(id a, id b) { return [b compare:a]; }];
    printf("sorted %d %d\n", ((NSNumber *)list[0]).intValue, ((NSNumber *)list[3]).intValue);
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
    NSArray<NSString *> *parts = [@"a,b,c" componentsSeparatedByString:@","];
    printf("parts %lu %s %s\n", (unsigned long)parts.count, [parts componentsJoinedByString:@"+"].UTF8String,
           [NSString pathWithComponents:@[ @"usr", @"lib" ]].UTF8String);
    NSMutableArray *more = [[NSMutableArray alloc] init];
    [more addObjectsFromArray:@[ @7, @8 ]];
    NSArray *both = [more arrayByAddingObjectsFromArray:@[ @9 ]];
    printf("bridged %lu %lu %d\n", (unsigned long)more.count, (unsigned long)both.count, [both[2] intValue]);
    NSArray *frameworks = [NSFileManager.defaultManager contentsOfDirectoryAtPath:@"/System/Library/Frameworks/AppKit.framework" error:NULL];
    printf("listed %s\n", [frameworks containsObject:@"Versions"] ? "true" : "false");
    NSError *error = nil;
    if ([NSFileManager.defaultManager contentsOfDirectoryAtPath:@"/nts-no-such-directory" error:&error]) {
      printf("listed a missing directory\n");
    } else {
      printf("thrown %s\n", error.localizedDescription.UTF8String);
    }
    NSArray<NSString *> *missing = [NSFileManager.defaultManager subpathsAtPath:@"/nts-no-such-directory"];
    NSArray<NSString *> *present = [NSFileManager.defaultManager subpathsAtPath:@"/System/Library/Frameworks/AppKit.framework"];
    printf("subpaths %s %s\n", missing == nil ? "true" : "false", [present containsObject:@"Versions"] ? "true" : "false");
    printf("predicates %s %s\n", [NSPredicate predicateWithFormat:@"TRUEPREDICATE" argumentArray:nil].predicateFormat.UTF8String,
           [NSPredicate predicateWithFormat:@"SELF == %@" argumentArray:@[ @3 ]].predicateFormat.UTF8String);
    NSAttributedString *attributed = [[NSAttributedString alloc] initWithString:@"hello world"];
    NSRange range = {0, 0};
    id font = [attributed attribute:@"NSFont" atIndex:3 effectiveRange:&range];
    printf("attributed %s %lu %lu\n", font == nil ? "true" : "false", (unsigned long)range.location, (unsigned long)range.length);
    printf("labelled %lu %s\n", (unsigned long)[@"x-y-z" componentsSeparatedByString:@"-"].count,
           [[@"p-q" componentsSeparatedByString:@"-"] componentsJoinedByString:@"+"].UTF8String);
    NSXMLParser *parser = [[NSXMLParser alloc] initWithData:[@"<a><b/><c><d/></c></a>" dataUsingEncoding:NSUTF8StringEncoding]];
    Elements *elements = [[Elements alloc] init];
    parser.delegate = elements;
    BOOL ok = [parser parse];
    printf("parsed %s %s %s\n", ok ? "true" : "false", elements.names.UTF8String,
           class_conformsToProtocol([Elements class], @protocol(NSXMLParserDelegate)) ? "adopted" : "not adopted");
    @autoreleasepool {
      printf("fields %s\n", tallied().UTF8String);
    }
    printf("fields %s released\n", tallyWatch ? "alive" : "gone");
    @autoreleasepool {
      printf("constructed %s\n", ledgered().UTF8String);
    }
    printf("constructed %s\n", ledgerWatch ? "alive" : "gone");
    printf("ledgers %s\n", [Ledger described].UTF8String);
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
