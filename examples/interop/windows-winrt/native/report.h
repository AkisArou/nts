// The one line of output this program has. Compiled programs have no stdio of
// their own (the GTK lane's blocker 2), so a report is a native call.
#ifndef NTS_WINDOWS_WINRT_REPORT_H
#define NTS_WINDOWS_WINRT_REPORT_H

// Prints `line` and a newline to stdout.
void report(const char *line);

// How many runtime classes the Windows Runtime has activated so far:
// `nts_winrt_activations`, which a cache that never hit would count up.
unsigned activations(void);

// How many COM references the program has released: `nts_com_releases`.
unsigned releases(void);

#endif
