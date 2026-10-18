#ifndef NTS_DESKTOP_H
#define NTS_DESKTOP_H
#define CINTERFACE
#include <shlobj.h>

// Owns the single SHGetDesktopFolder reference for the callback's duration,
// then releases it before reporting completion. No activation/CLSID is used.
unsigned with_desktop(void (*callback)(IShellFolder *, void *), void *context);
unsigned desktop_release_count(void);
#endif
