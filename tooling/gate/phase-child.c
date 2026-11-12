// A waited child keeps its original streams and exit cause. Only the private
// observation file carries wait4's rusage; no /proc sampling or policy lives
// here.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

static volatile sig_atomic_t child_pid;
extern char **environ;

static void forward(int signal) {
  if (child_pid > 0)
    kill(child_pid, signal);
}

static double seconds(struct timespec value) {
  return (double)value.tv_sec + (double)value.tv_nsec / 1000000000.0;
}

static double cpu_seconds(struct timeval value) {
  return (double)value.tv_sec + (double)value.tv_usec / 1000000.0;
}

int main(int argc, char **argv) {
  if (argc < 4 || argv[2][0] != '-' || argv[2][1] != '-' || argv[2][2]) {
    fputs("phase observation: expected <report> -- <command> [arguments]\n",
          stderr);
    return 125;
  }
  int report = open(argv[1], O_CREAT | O_EXCL | O_WRONLY | O_CLOEXEC, 0600);
  struct timespec start, end;
  clock_gettime(CLOCK_MONOTONIC, &start);
  sigset_t signals, previous;
  sigemptyset(&signals);
  sigaddset(&signals, SIGTERM);
  sigaddset(&signals, SIGINT);
  sigaddset(&signals, SIGHUP);
  sigprocmask(SIG_BLOCK, &signals, &previous);
  // The spawn owner reports launch failure directly, without another error
  // pipe or a copy of the observer's address space. The report is CLOEXEC;
  // only this observer can keep it open or publish waited accounting.
  posix_spawnattr_t attributes;
  int error = posix_spawnattr_init(&attributes);
  if (error) {
    errno = error;
    perror("phase observation: spawn attributes");
    return 125;
  }
  error = posix_spawnattr_setsigmask(&attributes, &previous);
  if (!error)
    error = posix_spawnattr_setflags(&attributes, POSIX_SPAWN_SETSIGMASK);
  pid_t child = 0;
  int exec_error = error ? error
                         : posix_spawnp(&child, argv[3], NULL, &attributes,
                                        argv + 3, environ);
  posix_spawnattr_destroy(&attributes);
  if (exec_error)
    child = 0;
  child_pid = child;
  struct sigaction action = {.sa_handler = forward};
  sigemptyset(&action.sa_mask);
  sigaction(SIGTERM, &action, NULL);
  sigaction(SIGINT, &action, NULL);
  sigaction(SIGHUP, &action, NULL);
  sigprocmask(SIG_SETMASK, &previous, NULL);
  int status = 0;
  struct rusage usage = {0};
  while (!exec_error && wait4(child, &status, 0, &usage) < 0) {
    if (errno == EINTR)
      continue;
    perror("phase observation: wait4");
    return 125;
  }
  child_pid = 0;
  clock_gettime(CLOCK_MONOTONIC, &end);
  if (report >= 0) {
    dprintf(report,
            "{\"version\":1,\"cpu_measure\":\"wait4-rusage-v1\","
            "\"pid\":%d,\"wall_s\":%.9f,\"user_s\":%.6f,\"sys_s\":%.6f,"
            "\"exit\":%d,\"signal\":%d,\"exec_errno\":%d}\n",
            child, seconds(end) - seconds(start), cpu_seconds(usage.ru_utime),
            cpu_seconds(usage.ru_stime),
            !exec_error && WIFEXITED(status) ? WEXITSTATUS(status) : -1,
            WIFSIGNALED(status) ? WTERMSIG(status) : 0, exec_error);
    close(report);
  }
  if (exec_error)
    return 127;
  if (WIFSIGNALED(status)) {
    int cause = WTERMSIG(status);
    signal(cause, SIG_DFL);
    raise(cause);
    return 128 + cause;
  }
  return WEXITSTATUS(status);
}
