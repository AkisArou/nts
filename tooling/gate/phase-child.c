// A waited child keeps its original streams and exit cause. Only the private
// observation file carries wait4's rusage; no /proc sampling or policy lives
// here.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

static volatile sig_atomic_t child_pid;

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
  int errors[2];
  if (pipe2(errors, O_CLOEXEC)) {
    perror("phase observation: exec error pipe");
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
  pid_t child = fork();
  if (child < 0) {
    perror("phase observation: fork");
    return 125;
  }
  if (!child) {
    close(errors[0]);
    if (report >= 0)
      close(report);
    sigprocmask(SIG_SETMASK, &previous, NULL);
    execvp(argv[3], argv + 3);
    int cause = errno;
    if (write(errors[1], &cause, sizeof(cause)) < 0) {
      // The parent may have been cancelled; the command still failed to exec.
    }
    _exit(127);
  }
  close(errors[1]);
  child_pid = child;
  struct sigaction action = {.sa_handler = forward};
  sigemptyset(&action.sa_mask);
  sigaction(SIGTERM, &action, NULL);
  sigaction(SIGINT, &action, NULL);
  sigaction(SIGHUP, &action, NULL);
  sigprocmask(SIG_SETMASK, &previous, NULL);
  int status;
  struct rusage usage;
  while (wait4(child, &status, 0, &usage) < 0) {
    if (errno == EINTR)
      continue;
    perror("phase observation: wait4");
    return 125;
  }
  child_pid = 0;
  clock_gettime(CLOCK_MONOTONIC, &end);
  int exec_error = 0;
  ssize_t count;
  do {
    count = read(errors[0], &exec_error, sizeof(exec_error));
  } while (count < 0 && errno == EINTR);
  close(errors[0]);
  if (report >= 0) {
    dprintf(report,
            "{\"version\":1,\"cpu_measure\":\"wait4-rusage-v1\","
            "\"pid\":%d,\"wall_s\":%.9f,\"user_s\":%.6f,\"sys_s\":%.6f,"
            "\"exit\":%d,\"signal\":%d,\"exec_errno\":%d}\n",
            child, seconds(end) - seconds(start), cpu_seconds(usage.ru_utime),
            cpu_seconds(usage.ru_stime),
            WIFEXITED(status) ? WEXITSTATUS(status) : -1,
            WIFSIGNALED(status) ? WTERMSIG(status) : 0, exec_error);
    close(report);
  }
  if (WIFSIGNALED(status)) {
    int cause = WTERMSIG(status);
    signal(cause, SIG_DFL);
    raise(cause);
    return 128 + cause;
  }
  return WEXITSTATUS(status);
}
