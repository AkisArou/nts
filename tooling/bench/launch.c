// The benchmark launch timer: process launch to exit, one child at a time.
//
// tooling/bench/README.md ("Launch rows") is the specification; launcher.ts
// is its only caller and parses what this prints. Nothing measured here
// passes through a wrapper process: this program pins itself to the timed
// CPU and sets its CPU and core limits once, before the first launch, and
// every child inherits them. Each launch is
//
//   clock_gettime(MONOTONIC) -> posix_spawn -> wait4(that pid) -> clock_gettime
//
// glibc's posix_spawn is clone(CLONE_VM | CLONE_VFORK) plus exec, so this
// process's size never enters the window. While a child runs, this process
// blocks in wait4 and nothing else. A child's stdout and stderr go to files
// opened before the clock starts, so a child never blocks on a pipe; they
// are read by the caller after the sitting.
//
// A bad request, a failed spawn or an unreadable clock exits 2 with the
// reason on stderr: an instrument error, never an observation.
//
// usage: nts-launch --cpu N --cpu-seconds S --wall-seconds W --warmups K
//          --launches N --cwd DIR --env FILE --columns FILE --out DIR
//
// FILE formats are NUL-separated: --env holds KEY=VALUE entries; --columns
// holds, per column, its label, its argument count in decimal, then its
// arguments, the first an absolute path. Output, one line each:
//
//   nts-launch 1 cpu=<N> columns=<C> rounds=<R>
//   L <column> <round> <warm 0|1> <wall ns> <exited 0|1> <status|signal>
//     <timed out 0|1> <user us> <system us> <max rss KiB>
//   end <launches>
//
// Rounds rotate the column order (round r starts at column r mod C), so
// drift during a sitting spreads over every column. Warm-up rounds come
// first and are timed the same way; launcher.ts keeps them apart.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <sched.h>
#include <signal.h>
#include <spawn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

enum { MAX_COLUMNS = 32, MAX_ARGS = 256, MAX_ENV = 256 };

static void fail(const char *what, const char *detail) {
  fprintf(stderr, "nts-launch: %s%s%s\n", what, detail ? ": " : "",
          detail ? detail : "");
  exit(2);
}

static long whole(const char *text, const char *name, long least) {
  char *end = NULL;
  errno = 0;
  long value = strtol(text, &end, 10);
  if (errno || end == text || *end || value < least)
    fail("invalid value for", name);
  return value;
}

/* A whole file, NUL-terminated, kept for the life of the process. */
static char *slurp(const char *path, size_t *length) {
  int fd = open(path, O_RDONLY | O_CLOEXEC);
  if (fd < 0)
    fail("cannot open", path);
  struct stat at;
  if (fstat(fd, &at) || at.st_size < 0 || at.st_size > (1 << 24))
    fail("cannot size", path);
  char *bytes = malloc((size_t)at.st_size + 1);
  if (!bytes)
    fail("out of memory reading", path);
  size_t read_so_far = 0;
  while (read_so_far < (size_t)at.st_size) {
    ssize_t got = read(fd, bytes + read_so_far, (size_t)at.st_size - read_so_far);
    if (got <= 0)
      fail("cannot read", path);
    read_so_far += (size_t)got;
  }
  close(fd);
  bytes[read_so_far] = '\0';
  *length = read_so_far;
  return bytes;
}

/* The next NUL-terminated field at *at, or NULL past the end. */
static char *field(char *bytes, size_t length, size_t *at) {
  if (*at >= length)
    return NULL;
  char *start = bytes + *at;
  size_t size = strnlen(start, length - *at);
  if (*at + size >= length)
    fail("unterminated field in a request file", NULL);
  *at += size + 1;
  return start;
}

struct column {
  char *label;
  char *argv[MAX_ARGS + 1];
};

static volatile sig_atomic_t expired;
static void on_alarm(int signal) {
  (void)signal;
  expired = 1;
}

static int64_t now_ns(void) {
  struct timespec at;
  if (clock_gettime(CLOCK_MONOTONIC, &at))
    fail("cannot read the monotonic clock", strerror(errno));
  return (int64_t)at.tv_sec * 1000000000 + at.tv_nsec;
}

static int open_output(const char *out, int column, int round,
                       const char *suffix) {
  char path[4096];
  int written = snprintf(path, sizeof path, "%s/%d-%d.%s", out, column, round,
                         suffix);
  if (written < 0 || (size_t)written >= sizeof path)
    fail("output path too long", out);
  int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
  if (fd < 0)
    fail("cannot create", path);
  return fd;
}

int main(int argc, char **argv) {
  long cpu = -1, cpu_seconds = -1, wall_seconds = -1, warmups = -1,
       launches = -1;
  const char *cwd = NULL, *env_file = NULL, *columns_file = NULL, *out = NULL;
  for (int i = 1; i < argc; i += 2) {
    if (i + 1 >= argc)
      fail("missing value for", argv[i]);
    const char *flag = argv[i], *value = argv[i + 1];
    if (!strcmp(flag, "--cpu"))
      cpu = whole(value, flag, 0);
    else if (!strcmp(flag, "--cpu-seconds"))
      cpu_seconds = whole(value, flag, 1);
    else if (!strcmp(flag, "--wall-seconds"))
      wall_seconds = whole(value, flag, 1);
    else if (!strcmp(flag, "--warmups"))
      warmups = whole(value, flag, 0);
    else if (!strcmp(flag, "--launches"))
      launches = whole(value, flag, 1);
    else if (!strcmp(flag, "--cwd"))
      cwd = value;
    else if (!strcmp(flag, "--env"))
      env_file = value;
    else if (!strcmp(flag, "--columns"))
      columns_file = value;
    else if (!strcmp(flag, "--out"))
      out = value;
    else
      fail("unknown argument", flag);
  }
  if (cpu < 0 || cpu_seconds < 0 || wall_seconds < 0 || warmups < 0 ||
      launches < 0 || !cwd || !env_file || !columns_file || !out)
    fail("every argument is required", NULL);
  if (out[0] != '/' || cwd[0] != '/')
    fail("--out and --cwd must be absolute", NULL);

  size_t env_length = 0, env_at = 0;
  char *env_bytes = slurp(env_file, &env_length);
  char *environment[MAX_ENV + 1];
  int env_count = 0;
  for (char *entry; (entry = field(env_bytes, env_length, &env_at));) {
    if (env_count == MAX_ENV || !strchr(entry, '=') || entry[0] == '=')
      fail("invalid environment entry", entry);
    environment[env_count++] = entry;
  }
  environment[env_count] = NULL;

  size_t columns_length = 0, columns_at = 0;
  char *column_bytes = slurp(columns_file, &columns_length);
  static struct column columns[MAX_COLUMNS];
  int count = 0;
  for (char *label; (label = field(column_bytes, columns_length, &columns_at));) {
    if (count == MAX_COLUMNS)
      fail("too many columns", NULL);
    char *arity = field(column_bytes, columns_length, &columns_at);
    if (!arity)
      fail("column without an argument count", label);
    long args = whole(arity, "column argument count", 1);
    if (args > MAX_ARGS)
      fail("too many arguments for", label);
    columns[count].label = label;
    for (long a = 0; a < args; a++) {
      columns[count].argv[a] = field(column_bytes, columns_length, &columns_at);
      if (!columns[count].argv[a])
        fail("column ends before its arguments", label);
    }
    columns[count].argv[args] = NULL;
    if (columns[count].argv[0][0] != '/')
      fail("a column's program must be an absolute path", label);
    count++;
  }
  if (!count)
    fail("no columns", NULL);

  cpu_set_t set;
  CPU_ZERO(&set);
  CPU_SET((int)cpu, &set);
  if (sched_setaffinity(0, sizeof set, &set))
    fail("cannot pin to the timed CPU", strerror(errno));
  struct rlimit cpu_limit = {(rlim_t)cpu_seconds, (rlim_t)cpu_seconds + 5};
  struct rlimit no_core = {0, 0};
  if (setrlimit(RLIMIT_CPU, &cpu_limit) || setrlimit(RLIMIT_CORE, &no_core))
    fail("cannot set the launch limits", strerror(errno));
  if (chdir(cwd))
    fail("cannot enter", cwd);
  struct sigaction alarm_action;
  memset(&alarm_action, 0, sizeof alarm_action);
  alarm_action.sa_handler = on_alarm; /* No SA_RESTART: wait4 returns EINTR. */
  if (sigaction(SIGALRM, &alarm_action, NULL))
    fail("cannot install the wall bound", strerror(errno));
  int input = open("/dev/null", O_RDONLY | O_CLOEXEC);
  if (input < 0)
    fail("cannot open /dev/null", NULL);

  long rounds = warmups + launches;
  printf("nts-launch 1 cpu=%ld columns=%d rounds=%ld\n", cpu, count, rounds);
  long total = 0;
  for (long round = 0; round < rounds; round++) {
    for (int step = 0; step < count; step++) {
      int column = (int)((round + step) % count);
      int stdout_fd = open_output(out, column, (int)round, "stdout");
      int stderr_fd = open_output(out, column, (int)round, "stderr");
      posix_spawn_file_actions_t actions;
      if (posix_spawn_file_actions_init(&actions) ||
          posix_spawn_file_actions_adddup2(&actions, input, 0) ||
          posix_spawn_file_actions_adddup2(&actions, stdout_fd, 1) ||
          posix_spawn_file_actions_adddup2(&actions, stderr_fd, 2))
        fail("cannot prepare a launch", columns[column].label);
      struct itimerval bound = {{0, 0}, {wall_seconds, 0}};
      expired = 0;
      if (setitimer(ITIMER_REAL, &bound, NULL))
        fail("cannot arm the wall bound", strerror(errno));
      pid_t child;
      int64_t began = now_ns();
      int spawned = posix_spawn(&child, columns[column].argv[0], &actions, NULL,
                                columns[column].argv, environment);
      if (spawned)
        fail("cannot launch", columns[column].argv[0]);
      int status = 0, timed_out = 0;
      struct rusage usage;
      for (;;) {
        pid_t reaped = wait4(child, &status, 0, &usage);
        if (reaped == child)
          break;
        if (reaped < 0 && errno == EINTR && expired && !timed_out) {
          timed_out = 1;
          kill(child, SIGKILL);
          continue;
        }
        if (reaped < 0 && errno == EINTR)
          continue;
        fail("cannot wait for a launch", strerror(errno));
      }
      int64_t ended = now_ns();
      struct itimerval off = {{0, 0}, {0, 0}};
      setitimer(ITIMER_REAL, &off, NULL);
      posix_spawn_file_actions_destroy(&actions);
      close(stdout_fd);
      close(stderr_fd);
      int exited = WIFEXITED(status);
      int code = exited ? WEXITSTATUS(status)
                        : WIFSIGNALED(status) ? WTERMSIG(status) : -1;
      int64_t user = (int64_t)usage.ru_utime.tv_sec * 1000000 +
                     usage.ru_utime.tv_usec;
      int64_t system = (int64_t)usage.ru_stime.tv_sec * 1000000 +
                       usage.ru_stime.tv_usec;
      printf("L %d %ld %d %" PRId64 " %d %d %d %" PRId64 " %" PRId64 " %ld\n",
             column, round, round < warmups, ended - began, exited, code,
             timed_out, user, system, usage.ru_maxrss);
      total++;
    }
  }
  printf("end %ld\n", total);
  if (fflush(stdout) || ferror(stdout))
    fail("cannot write the observations", NULL);
  return 0;
}
