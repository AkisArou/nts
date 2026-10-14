#include "report.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

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

// A Win32 message loop, as a windowed program runs one from inside module
// evaluation, until `quit_message_loop` posts WM_QUIT. libuv turns inside it
// only through the win host's wake message.
void run_message_loop(void) {
  MSG message;
  while (GetMessageW(&message, 0, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
}

void quit_message_loop(void) { PostQuitMessage(0); }

static void CALLBACK quit_now(HWND window, UINT message, UINT_PTR id,
                              DWORD time) {
  (void)window;
  (void)message;
  (void)time;
  KillTimer(0, id);
  PostQuitMessage(0);
}

// WM_QUIT after `ms`, from a Win32 timer: nothing of libuv's.
void quit_message_loop_after(unsigned ms) { SetTimer(0, 0, ms, quit_now); }

// The process's CPU time so far, user and kernel, in milliseconds.
double process_cpu_ms(void) {
  FILETIME created, exited, kernel, user;
  GetProcessTimes(GetCurrentProcess(), &created, &exited, &kernel, &user);
  ULARGE_INTEGER k = {{kernel.dwLowDateTime, kernel.dwHighDateTime}};
  ULARGE_INTEGER u = {{user.dwLowDateTime, user.dwHighDateTime}};
  return (double)(k.QuadPart + u.QuadPart) / 10000.0;
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
