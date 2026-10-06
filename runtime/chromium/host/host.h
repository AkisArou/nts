#ifndef NTS_CHROMIUM_HOST_HOST_H_
#define NTS_CHROMIUM_HOST_HOST_H_

/* The host of one compiled program in one Blink document: the program's NTS
 * environment, the entry every native callback makes into it, and the
 * renderer services the runtime asks a host for. Every client of the renderer
 * -- an app (app.c), the test probe (embedder/probe.c) -- is built on this.
 *
 * C, with the runtime's and the program's headers: only the opaque handles
 * cross into C++ (app.h, embedder/probe.h). Main thread only. */

#include <stdbool.h>
#include <stddef.h>

#include "nts_runtime.h"

typedef struct NtsDomContext NtsDomContext;
typedef struct NtsChromiumHost NtsChromiumHost;

/* An entry into the program: its environment entered, and the callback
 * barrier up, so no raise lands past the C++ caller. */
typedef struct NtsChromiumHostScope {
  NtsEnvironmentScope environment;
  NtsChromiumHost* host;
} NtsChromiumHostScope;

/* A fresh environment for one document's program. */
NtsChromiumHost* nts_chromium_host_create(void);

NtsChromiumHostScope nts_chromium_host_enter(NtsChromiumHost* host);
/* Leaves the entry. Leaving the outermost one finishes a destroy that waited
 * for it, or queues the busy period's idle collection. */
void nts_chromium_host_leave(NtsChromiumHostScope* scope);

/* Selects the environment without opening an entry: for instrumentation
 * that reads the runtime's counters around entries it measures. Paired with
 * nts_environment_leave. */
NtsEnvironmentScope nts_chromium_host_select(NtsChromiumHost* host);

/* Lets the context's callbacks -- listeners, handlers, frames, timers --
 * enter the program, in this host's environment. */
void nts_chromium_host_attach(NtsChromiumHost* host, NtsDomContext* context);

/* Blink owns the program's microtasks (the agent's queue, drained at
 * Blink's checkpoints), and cycles are collected in idle time, once per busy
 * period, rather than at every checkpoint, which walks everything the
 * candidates reach -- the whole application state -- per callback. */
void nts_chromium_host_install(NtsChromiumHost* host, NtsDomContext* context);

/* The idle collection, callable directly where idle time cannot occur. */
void nts_chromium_host_collect_idle(NtsChromiumHost* host);

/* Ends the environment once no entry is under way -- at once, or when the
 * outermost one leaves. `release`, if given, runs in the environment first,
 * to drop what the client still holds; then cycles are collected, and
 * nothing of the program may remain. */
void nts_chromium_host_destroy(NtsChromiumHost* host,
                               void (*release)(void* state),
                               void* state);

/* Stops the renderer saying why: a raise the program left pending is
 * reported as the uncaught error it is; anything else names the function
 * and line. */
_Noreturn void nts_chromium_host_fail(const char* function, int line);
#define NTS_CHROMIUM_HOST_FAIL() nts_chromium_host_fail(__func__, __LINE__)

#endif
