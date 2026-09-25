// The one line of output this program has. Compiled programs have no stdio of
// their own (the GTK lane's blocker 2), so a report is a native call.
#ifndef NTS_WINDOWS_WINRT_REPORT_H
#define NTS_WINDOWS_WINRT_REPORT_H

#include <stdbool.h>

// Prints `line` and a newline to stdout.
void report(const char *line);

// How many runtime classes the Windows Runtime has activated so far:
// `nts_winrt_activations`, which a cache that never hit would count up.
unsigned activations(void);

// How many COM references the program has released: `nts_com_releases`.
unsigned releases(void);

// Whether the program was run with `word` as its first argument: how the
// build selects an arm without a second program.
bool asked(const char *word);

// How many delegate objects the program made are alive: `nts_com_delegates`.
unsigned delegates(void);

// How many operations the program awaits are outstanding.
unsigned pending(void);

// Calls a delegate's `Invoke` with `sender` on a thread of its own, after
// 100 ms, and releases both there 300 ms later.
void invoke_elsewhere(void *delegate, void *sender);

#endif
