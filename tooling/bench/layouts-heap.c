// Measurement-only startup placement. No malloc/free interposition: live
// padding shifts allocator placement before main and before each thread body.
// This samples startup placement, not arbitrary per-object permutations.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

enum { MAX_THREADS = 128, MAX_BLOCKS = 33 };
static void *held[MAX_THREADS][MAX_BLOCKS];
static _Atomic unsigned next_thread;
static uint32_t seed;
static const char *report_path;
static int (*create_thread)(pthread_t *, const pthread_attr_t *,
                            void *(*)(void *), void *);
static pthread_once_t resolved = PTHREAD_ONCE_INIT;

static void fatal(void) { _exit(125); }

static uint32_t draw(uint32_t *state) {
  *state ^= *state << 13;
  *state ^= *state >> 17;
  *state ^= *state << 5;
  return *state;
}

static void resolve_thread(void) {
  void *symbol = dlsym(RTLD_NEXT, "pthread_create");
  _Static_assert(sizeof(symbol) == sizeof(create_thread),
                 "POSIX function pointer ABI");
  if (!symbol)
    fatal();
  memcpy(&create_thread, &symbol, sizeof(create_thread));
}

static void place_thread(void) {
  if (!seed)
    return;
  unsigned ordinal = atomic_fetch_add(&next_thread, 1);
  if (ordinal >= MAX_THREADS)
    fatal();
  uint32_t state = seed ^ (UINT32_C(0x9e3779b9) * (ordinal + 1));
  if (!state)
    state = UINT32_C(0x6d2b79f5);
  unsigned blocks = 8 + draw(&state) % 24;
  size_t requested = 0;
  for (unsigned i = 0; i < blocks; i++) {
    // Stay below the usual mmap threshold; keep every block live so this
    // introduces no free-list entries or per-allocation timed wrapper.
    size_t size = 16 * (1 + draw(&state) % 4096);
    volatile unsigned char *p = malloc(size);
    if (!p)
      fatal();
    held[ordinal][i] = (void *)p;
    for (size_t offset = 0; offset < size; offset += 4096)
      p[offset] = 0;
    p[size - 1] = 0;
    requested += size;
  }
  void *anchor = malloc(64);
  if (!anchor)
    fatal();
  held[ordinal][blocks] = anchor;
  char line[384];
  int length = snprintf(
      line, sizeof(line),
      "{\"schema\":1,\"pid\":%ld,\"tid\":%ld,\"seed\":%u,\"thread\":%u,"
      "\"blocks\":%u,\"requested\":%zu,\"anchor\":%llu}\n",
      (long)getpid(), syscall(SYS_gettid), seed, ordinal, blocks + 1,
      requested + 64, (unsigned long long)(uintptr_t)anchor);
  if (length <= 0 || (size_t)length >= sizeof(line))
    fatal();
  int fd = open(report_path, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0600);
  if (fd < 0)
    fatal();
  ssize_t written = write(fd, line, (size_t)length);
  if (close(fd) || written != length)
    fatal();
}

__attribute__((constructor)) static void initialize_layout(void) {
  const char *text = getenv("NTS_LAYOUT_HEAP_SEED");
  if (!text)
    return;
  if (!*text)
    fatal();
  errno = 0;
  char *end = NULL;
  unsigned long value = strtoul(text, &end, 10);
  if (errno || !end || *end || value > UINT32_MAX || value == 0)
    fatal();
  seed = (uint32_t)value;
  report_path = getenv("NTS_LAYOUT_HEAP_REPORT");
  if (!report_path || !*report_path)
    fatal();
  if (pthread_once(&resolved, resolve_thread))
    fatal();
  place_thread();
}

struct ThreadStart {
  void *(*function)(void *);
  void *argument;
};

static void *thread_entry(void *argument) {
  struct ThreadStart start = *(struct ThreadStart *)argument;
  free(argument);
  place_thread();
  return start.function(start.argument);
}

int pthread_create(pthread_t *thread, const pthread_attr_t *attributes,
                   void *(*function)(void *), void *argument) {
  if (pthread_once(&resolved, resolve_thread))
    fatal();
  if (!seed)
    return create_thread(thread, attributes, function, argument);
  struct ThreadStart *start = malloc(sizeof(*start));
  if (!start)
    return ENOMEM;
  start->function = function;
  start->argument = argument;
  int result = create_thread(thread, attributes, thread_entry, start);
  if (result)
    free(start);
  return result;
}
