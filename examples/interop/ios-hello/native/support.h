// Output, the application's start, and its end: UIKit's `UIApplicationMain`,
// given the delegate class by name, and `exit` once the run has said what it
// should.
#ifndef NTS_IOS_HELLO_SUPPORT_H
#define NTS_IOS_HELLO_SUPPORT_H

void report(const char *line);
void ios_main(const char *delegate);
void ios_exit(int code);

#endif
