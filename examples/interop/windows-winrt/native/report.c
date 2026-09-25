#include "report.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

void report(const char *line) {
#ifdef _WIN32
  // node writes `\n`, and a text-mode stdout on Windows would write `\r\n`.
  static int binary;
  if (!binary) {
    _setmode(_fileno(stdout), _O_BINARY);
    binary = 1;
  }
#endif
  fputs(line, stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

#include "nts_runtime.h"

unsigned activations(void) {
  return nts_winrt_activations();
}

unsigned releases(void) {
  return nts_com_releases();
}

bool asked(const char *word) {
#ifdef _WIN32
  return __argc > 1 && strcmp(__argv[1], word) == 0;
#else
  (void)word;
  return 0;
#endif
}

unsigned delegates(void) {
  return nts_com_delegates();
}

unsigned pending(void) {
  return nts_pending_count();
}

#ifdef _WIN32
#include <windows.h>

// A delegate called on a thread the program does not own, as an async
// operation's `Completed` is: after 100 ms, with `sender`, and released
// there 300 ms later -- after the program has given its own reference back
// and the carried call has run and given back the one it held, so that this
// release is the last. (Released at once, it is not: the carry's reference
// outlives it.)
typedef struct {
  void *delegate;
  void *sender;
} Elsewhere;

static void com_release(void *object) {
  ((ULONG(STDMETHODCALLTYPE *)(void *))(*(void ***)object)[2])(object);
}

static DWORD WINAPI elsewhere(void *argument) {
  Elsewhere *e = argument;
  Sleep(100);
  ((HRESULT(STDMETHODCALLTYPE *)(void *, void *))(*(void ***)e->delegate)[3])(
      e->delegate, e->sender);
  Sleep(300);
  com_release(e->sender);
  com_release(e->delegate);
  free(e);
  return 0;
}

void invoke_elsewhere(void *delegate, void *sender) {
  Elsewhere *e = malloc(sizeof *e);
  e->delegate = delegate;
  e->sender = sender;
  ((ULONG(STDMETHODCALLTYPE *)(void *))(*(void ***)delegate)[1])(delegate);
  ((ULONG(STDMETHODCALLTYPE *)(void *))(*(void ***)sender)[1])(sender);
  CloseHandle(CreateThread(0, 0, elsewhere, e, 0, 0));
}
#endif
