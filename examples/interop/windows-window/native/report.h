// The one line of output this program has. Compiled programs have no stdio of
// their own (the GTK lane's blocker 2), so a report is a native call.
#ifndef NTS_WINDOWS_WINDOW_REPORT_H
#define NTS_WINDOWS_WINDOW_REPORT_H

// Prints `line` and a newline to stdout.
void report(const char *line);

#endif
