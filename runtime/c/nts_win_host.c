#include "nts_win_host.h"

#include "nts_uv_host.h"

#include <stdio.h>
#include <stdlib.h>
#include <windows.h>

/* The message the watcher posts, and the completion key of its own wake-up
 * packet, which it must not hand back to libuv. A nudge the watcher never
 * dequeues -- posted just after it woke for a real packet -- is found by
 * `uv_run` instead, which skips a packet with no OVERLAPPED ("an empty package
 * meant only to wake us up", `src/win/core.c`). */
#define NTS_WIN_HOST_WAKE (WM_APP + 0x0e75)

/* The key is the address of a byte of this file's, which no handle libuv
 * associates with the port can share. */
static char nts_win_host_nudge_byte;
static ULONG_PTR nts_win_host_nudge(void) {
  return (ULONG_PTR)&nts_win_host_nudge_byte;
}
static HWND nts_win_host_window;
static HANDLE nts_win_host_thread;
static HANDLE nts_win_host_iocp;
/* Released by the owner thread each time the watcher may wait again. */
static HANDLE nts_win_host_rearm;
/* Written by the owner thread before each release, read by the watcher after
 * it acquires: the semaphore orders the two. */
static DWORD nts_win_host_wait_ms;
static volatile LONG nts_win_host_stopping;

/* Owner-thread state. `armed` is true while the watcher is waiting with
 * `armed_ms`, and false from a nudge or a wake until the next re-arm, so a
 * burst of timers started in one window procedure nudges once. */
static bool nts_win_host_armed;
static int nts_win_host_armed_ms;
static bool nts_win_host_pumping;

static void nts_win_host_fail(const char *what) {
  fprintf(stderr, "nts: the Win32 loop host %s (error %lu)\n", what,
          (unsigned long)GetLastError());
  abort();
}

static DWORD WINAPI nts_win_host_watch(LPVOID unused) {
  (void)unused;
  for (;;) {
    WaitForSingleObject(nts_win_host_rearm, INFINITE);
    if (nts_win_host_stopping) {
      return 0;
    }
    DWORD bytes = 0;
    ULONG_PTR key = 0;
    OVERLAPPED *overlapped = NULL;
    BOOL got = GetQueuedCompletionStatus(nts_win_host_iocp, &bytes, &key,
                                         &overlapped, nts_win_host_wait_ms);
    /* A packet was dequeued -- a completion, or a failed operation's, which
     * carries its status in the OVERLAPPED -- and belongs to libuv: put it
     * back for `uv_run` to find. Only the host's own nudge is consumed. */
    if ((got || overlapped != NULL) && key != nts_win_host_nudge()) {
      PostQueuedCompletionStatus(nts_win_host_iocp, bytes, key, overlapped);
    }
    if (nts_win_host_stopping) {
      return 0;
    }
    PostMessageW(nts_win_host_window, NTS_WIN_HOST_WAKE, 0, 0);
  }
}

/* Let the watcher wait again, as long as libuv's next deadline. */
static void nts_win_host_arm(void) {
  int due = nts_uv_host_backend_timeout();
  nts_win_host_wait_ms = due < 0 ? INFINITE : (DWORD)due;
  nts_win_host_armed = true;
  nts_win_host_armed_ms = due;
  ReleaseSemaphore(nts_win_host_rearm, 1, NULL);
}

/* Work was scheduled outside a pump. If it is due sooner than the watcher
 * will wake, wake it now with a packet of the host's own. Never while
 * pumping: the re-arm after the pump reads the new deadline anyway. */
static void nts_win_host_scheduled(void) {
  if (nts_win_host_pumping || !nts_win_host_armed) {
    return;
  }
  int due = nts_uv_host_backend_timeout();
  if (nts_win_host_armed_ms >= 0 && (due < 0 || due >= nts_win_host_armed_ms)) {
    return;
  }
  nts_win_host_armed = false;
  PostQueuedCompletionStatus(nts_win_host_iocp, 0, nts_win_host_nudge(), NULL);
}

static LRESULT CALLBACK nts_win_host_procedure(HWND window, UINT message,
                                               WPARAM w, LPARAM l) {
  if (message != NTS_WIN_HOST_WAKE) {
    return DefWindowProcW(window, message, w, l);
  }
  /* A wake delivered by a modal loop inside a pump -- a task that opened a
   * `MessageBox` -- finds libuv already running. The outer pump re-arms when
   * it returns; re-arming here would spin the watcher against a loop that
   * cannot run. */
  if (nts_win_host_pumping) {
    return 0;
  }
  nts_win_host_armed = false;
  nts_win_host_pumping = true;
  nts_uv_host_pump();
  nts_win_host_pumping = false;
  nts_win_host_arm();
  return 0;
}

void nts_win_host_attach(void) {
  if (nts_win_host_window) {
    return;
  }
  HINSTANCE instance = GetModuleHandleW(NULL);
  WNDCLASSEXW cls = {0};
  cls.cbSize = sizeof cls;
  cls.lpfnWndProc = nts_win_host_procedure;
  cls.hInstance = instance;
  cls.lpszClassName = L"NtsLoopHost";
  if (!RegisterClassExW(&cls)) {
    nts_win_host_fail("could not register its window class");
  }
  /* Message-only: never shown, never enumerated, and not a top-level window a
   * program's own loop could be waiting on. */
  nts_win_host_window = CreateWindowExW(0, L"NtsLoopHost", L"", 0, 0, 0, 0, 0,
                                        HWND_MESSAGE, NULL, instance, NULL);
  if (!nts_win_host_window) {
    nts_win_host_fail("could not create its message window");
  }
  nts_win_host_iocp = nts_uv_host_loop()->iocp;
  nts_win_host_rearm = CreateSemaphoreW(NULL, 0, 1, NULL);
  if (!nts_win_host_rearm) {
    nts_win_host_fail("could not create its semaphore");
  }
  nts_win_host_thread =
      CreateThread(NULL, 0, nts_win_host_watch, NULL, 0, NULL);
  if (!nts_win_host_thread) {
    nts_win_host_fail("could not start its watcher thread");
  }
  nts_uv_host_on_schedule(nts_win_host_scheduled);
  nts_win_host_arm();
}

void nts_win_host_detach(void) {
  if (!nts_win_host_window) {
    return;
  }
  nts_uv_host_on_schedule(NULL);
  InterlockedExchange(&nts_win_host_stopping, 1);
  /* Whichever wait the watcher is in, one of these ends it. */
  ReleaseSemaphore(nts_win_host_rearm, 1, NULL);
  PostQueuedCompletionStatus(nts_win_host_iocp, 0, nts_win_host_nudge(), NULL);
  WaitForSingleObject(nts_win_host_thread, INFINITE);
  CloseHandle(nts_win_host_thread);
  CloseHandle(nts_win_host_rearm);
  DestroyWindow(nts_win_host_window);
  UnregisterClassW(L"NtsLoopHost", GetModuleHandleW(NULL));
  nts_win_host_window = NULL;
  nts_win_host_thread = NULL;
}
