// The oracle: `src/main.ts` in Objective-C, compiled with the pods' sources:
// Chirp's, and Hum's Swift, through the header Swift writes for it; Beep,
// linked from its framework; and Mix, whose Swift is compiled against its
// Objective-C and whose Objective-C against its Swift's header.
#import "Chirp.h"
#import "Hum-Swift.h"
#import "MXCounter.h"
#import "Mix-Swift.h"
#import "Echo-Swift.h"
#import <Beep/Beep.h>
#include <stdio.h>

int main(void) {
  @autoreleasepool {
    Chirp *chirp = [[Chirp alloc] initWithBird:@"wren"];
    printf("song %s\n", [chirp songWithNotes:3].UTF8String);
    printf("bird %s\n", chirp.bird.UTF8String);
    printf("version %s\n", Chirp.version.UTF8String);
    Hum *hum = [[Hum alloc] initWithTune:@"la"];
    printf("hum %s\n", [hum hummedWithTimes:3].UTF8String);
    printf("beep %s\n", [Beep beepTimes:2].UTF8String);
    MXTally *tally = [[MXTally alloc] init];
    printf("mix %ld %s\n", (long)[tally twice], [tally summary].UTF8String);
    MXCounter *counter = [[MXCounter alloc] init];
    [counter next];
    printf("mix counter %s\n", [counter summary].UTF8String);
    printf("echo %s\n", [[[Echo alloc] init] echoed:@"jay"].UTF8String);
  }
  return 0;
}
