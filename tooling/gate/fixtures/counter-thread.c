// The expensive thread/fork starts only after the parent receives READY.
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

static volatile uint64_t result;
static void *work(void *unused) {
  (void)unused;
  uint64_t x = 1;
  for (uint64_t i = 0; i < 30000000; ++i)
    x = (x ^ i) * UINT64_C(6364136223846793005) + 1;
  result = x;
  return NULL;
}
static void terminated(int sig) {
  (void)sig;
  const char message[] = "TERMINATED\n";
  (void)write(STDOUT_FILENO, message, sizeof(message) - 1);
  _exit(42);
}
int main(int argc, char **argv) {
  signal(SIGTERM, terminated);
  puts("READY");
  fflush(stdout);
  if (getchar() == EOF) return 3;
  if (argc > 1 && (strcmp(argv[1], "fork") == 0 || strcmp(argv[1], "fork-hold") == 0)) {
    pid_t child = fork();
    if (child < 0) return 4;
    if (child == 0) {
      if (strcmp(argv[1], "fork-hold") == 0) {
        puts("CHILD_READY");
        fflush(stdout);
        for (;;) pause();
      }
      work(NULL);
      _exit(0);
    }
    int status;
    return waitpid(child, &status, 0) == child && WIFEXITED(status) ? WEXITSTATUS(status) : 5;
  }
  pthread_t thread;
  if (pthread_create(&thread, NULL, work, NULL) != 0) return 6;
  if (pthread_join(thread, NULL) != 0) return 7;
  printf("DONE %llu\n", (unsigned long long)result);
  return 0;
}
