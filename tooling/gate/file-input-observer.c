/* Observation, not access control. Notifications describe attempts; CONTINUE
 * supplies no return value. No pathname or image is treated as authorization.
 * https://docs.kernel.org/userspace-api/seccomp_filter.html */
#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <poll.h>
#include <signal.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/uio.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#if defined(__x86_64__)
#define OBSERVER_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define OBSERVER_ARCH AUDIT_ARCH_AARCH64
#else
#error "file input observation requires a supported Linux syscall ABI"
#endif

enum { PATH_BYTES = 4096, ARGV_BYTES = 65536 };
/* Startup and post-root drain can wedge independently. A running command has
 * its existing owner's bounds; only these orphanable phases get five minutes.
 */
static const uint64_t WEDGED_NS = UINT64_C(300) * UINT64_C(1000000000);
static int phase_timeout_ms(bool bounded, uint64_t elapsed_ns) {
  if (!bounded)
    return -1;
  if (elapsed_ns >= WEDGED_NS)
    return 0;
  return (int)((WEDGED_NS - elapsed_ns + 999999) / 1000000);
}

typedef struct {
  int number;
  const char *name, *operation;
  int paths[2], dirfds[2];
  unsigned count;
} Call;
#define PLAIN(n, op) {SYS_##n, #n, op, {0, -1}, {-1, -1}, 1}
#define AT(n, op) {SYS_##n, #n, op, {1, -1}, {0, -1}, 1}
/* This table builds the filter and decodes the same notifications. */
static const Call CALLS[] = {
#ifdef SYS_open
    PLAIN(open, "open"),
#endif
    AT(openat, "open"),
#ifdef SYS_openat2
    AT(openat2, "open"),
#endif
#ifdef SYS_stat
    PLAIN(stat, "lookup"),
#endif
#ifdef SYS_lstat
    PLAIN(lstat, "lookup"),
#endif
#ifdef SYS_newfstatat
    AT(newfstatat, "lookup"),
#endif
#ifdef SYS_statx
    AT(statx, "lookup"),
#endif
#ifdef SYS_access
    PLAIN(access, "lookup"),
#endif
#ifdef SYS_faccessat
    AT(faccessat, "lookup"),
#endif
#ifdef SYS_faccessat2
    AT(faccessat2, "lookup"),
#endif
#ifdef SYS_readlink
    PLAIN(readlink, "lookup"),
#endif
    AT(readlinkat, "lookup"),
    {SYS_fstat, "fstat", "descriptor", {-1, -1}, {0, -1}, 0},
#ifdef SYS_getdents
    {SYS_getdents, "getdents", "directory", {-1, -1}, {0, -1}, 0},
#endif
    {SYS_getdents64, "getdents64", "directory", {-1, -1}, {0, -1}, 0},
    PLAIN(execve, "execute"),
#ifdef SYS_execveat
    AT(execveat, "execute"),
#endif
#ifdef SYS_chdir
    PLAIN(chdir, "context"),
#endif
    {SYS_fchdir, "fchdir", "context", {-1, -1}, {0, -1}, 0},
    {SYS_exit, "exit", "lifetime", {-1, -1}, {-1, -1}, 0},
    {SYS_exit_group, "exit_group", "lifetime", {-1, -1}, {-1, -1}, 0},
#ifdef SYS_link
    {SYS_link, "link", "link", {0, 1}, {-1, -1}, 2},
#endif
    {SYS_linkat, "linkat", "link", {1, 3}, {0, 2}, 2},
#ifdef SYS_symlink
    {SYS_symlink, "symlink", "symlink", {0, 1}, {-1, -1}, 2},
#endif
    {SYS_symlinkat, "symlinkat", "symlink", {0, 2}, {-1, 1}, 2},
#ifdef SYS_unlink
    PLAIN(unlink, "mutation"),
#endif
    AT(unlinkat, "mutation"),
#ifdef SYS_rename
    {SYS_rename, "rename", "mutation", {0, 1}, {-1, -1}, 2},
#endif
    {SYS_renameat, "renameat", "mutation", {1, 3}, {0, 2}, 2},
#ifdef SYS_renameat2
    {SYS_renameat2, "renameat2", "mutation", {1, 3}, {0, 2}, 2},
#endif
#ifdef SYS_mkdir
    PLAIN(mkdir, "mutation"),
#endif
    AT(mkdirat, "mutation"),
#ifdef SYS_rmdir
    PLAIN(rmdir, "mutation"),
#endif
#ifdef SYS_truncate
    PLAIN(truncate, "mutation"),
#endif
};
#undef PLAIN
#undef AT

typedef struct {
  unsigned char data[ARGV_BYTES];
  size_t size;
  int error;
  bool truncated, null;
} Bytes;
typedef struct {
  int stage, error;
} ChildError;
static FILE *output;
static unsigned long errors, attempts;
static bool output_failed;

static void fatal(const char *what) {
  fprintf(stderr, "file input observer: %s: %s\n", what, strerror(errno));
  exit(2);
}
static uint64_t now_ns(void) {
  struct timespec t;
  if (clock_gettime(CLOCK_MONOTONIC, &t))
    fatal("clock");
  return (uint64_t)t.tv_sec * 1000000000 + (uint64_t)t.tv_nsec;
}
static void hex(const unsigned char *data, size_t size) {
  static const char digits[] = "0123456789abcdef";
  for (size_t i = 0; i < size; i++) {
    fputc(digits[data[i] >> 4], output);
    fputc(digits[data[i] & 15], output);
  }
}
static void bytes_json(const Bytes *b) {
  fputs("{\"hex\":\"", output);
  hex(b->data, b->size);
  fprintf(output, "\",\"error\":%d,\"truncated\":%s,\"null\":%s}", b->error,
          b->truncated ? "true" : "false", b->null ? "true" : "false");
}
static Bytes read_link(const char *path) {
  Bytes b = {0};
  ssize_t n = readlink(path, (char *)b.data, PATH_BYTES);
  if (n < 0)
    b.error = errno;
  else {
    b.size = (size_t)n;
    b.truncated = n == PATH_BYTES;
  }
  return b;
}
static Bytes proc_link(pid_t tid, const char *member) {
  char path[96];
  snprintf(path, sizeof(path), "/proc/%d/%s", tid, member);
  return read_link(path);
}
static Bytes read_file(const char *path, size_t limit) {
  Bytes b = {0};
  int fd = open(path, O_RDONLY | O_CLOEXEC);
  if (fd < 0) {
    b.error = errno;
    return b;
  }
  while (b.size < limit) {
    ssize_t n = read(fd, b.data + b.size, limit - b.size);
    if (n < 0) {
      if (errno == EINTR)
        continue;
      b.error = errno;
      break;
    }
    if (!n)
      break;
    b.size += (size_t)n;
  }
  if (b.size == limit) {
    unsigned char extra;
    ssize_t n = read(fd, &extra, 1);
    if (n > 0)
      b.truncated = true;
    else if (n < 0)
      b.error = errno;
  }
  close(fd);
  return b;
}
static Bytes remote_path(pid_t tid, uint64_t address) {
  Bytes b = {0};
  if (!address) {
    b.null = true;
    return b;
  }
  while (b.size < PATH_BYTES) {
    size_t chunk = 256;
    if (chunk > PATH_BYTES - b.size)
      chunk = PATH_BYTES - b.size;
    struct iovec local = {.iov_base = b.data + b.size, .iov_len = chunk};
    struct iovec remote = {.iov_base = (void *)(uintptr_t)(address + b.size),
                           .iov_len = chunk};
    ssize_t n = process_vm_readv(tid, &local, 1, &remote, 1, 0);
    if (n < 0) {
      if (errno == EINTR)
        continue;
      b.error = errno;
      break;
    }
    if (!n) {
      b.error = EFAULT;
      break;
    }
    unsigned char *end = memchr(b.data + b.size, 0, (size_t)n);
    if (end) {
      b.size = (size_t)(end - b.data);
      return b;
    }
    b.size += (size_t)n;
  }
  if (b.size == PATH_BYTES)
    b.truncated = true;
  return b;
}
static bool good(const Bytes *b) { return !b->error && !b->truncated; }
static void record_error(const char *message, int error) {
  errors++;
  fprintf(output, "{\"kind\":\"error\",\"message\":\"%s\",\"errno\":%d}\n",
          message, error);
}
static void check_output(void) {
  if (ferror(output))
    output_failed = true;
}
static int pass_fd(int socket, int fd) {
  char byte = 'L', control[CMSG_SPACE(sizeof(int))] = {0};
  struct iovec io = {.iov_base = &byte, .iov_len = 1};
  struct msghdr message = {.msg_iov = &io,
                           .msg_iovlen = 1,
                           .msg_control = control,
                           .msg_controllen = sizeof(control)};
  struct cmsghdr *header = CMSG_FIRSTHDR(&message);
  header->cmsg_level = SOL_SOCKET;
  header->cmsg_type = SCM_RIGHTS;
  header->cmsg_len = CMSG_LEN(sizeof(int));
  memcpy(CMSG_DATA(header), &fd, sizeof(fd));
  return sendmsg(socket, &message, 0) == 1 ? 0 : -1;
}
static int receive_fd(int socket) {
  char byte = 0, control[CMSG_SPACE(sizeof(int))] = {0};
  struct iovec io = {.iov_base = &byte, .iov_len = 1};
  struct msghdr message = {.msg_iov = &io,
                           .msg_iovlen = 1,
                           .msg_control = control,
                           .msg_controllen = sizeof(control)};
  if (recvmsg(socket, &message, MSG_CMSG_CLOEXEC) != 1)
    return -1;
  struct cmsghdr *header = CMSG_FIRSTHDR(&message);
  int fd = -1;
  if (!header || header->cmsg_level != SOL_SOCKET ||
      header->cmsg_type != SCM_RIGHTS ||
      header->cmsg_len != CMSG_LEN(sizeof(int)) ||
      (message.msg_flags & MSG_CTRUNC)) {
    errno = EPROTO;
    return -1;
  }
  memcpy(&fd, CMSG_DATA(header), sizeof(fd));
  return fd;
}
static int install_filter(void) {
  struct sock_filter code[2 * (sizeof(CALLS) / sizeof(CALLS[0])) + 9];
  unsigned n = 0;
#define PUSH(value) code[n++] = (struct sock_filter)value
  PUSH(BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)));
  PUSH(BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, OBSERVER_ARCH, 1, 0));
  PUSH(BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_USER_NOTIF));
  PUSH(BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)));
#if defined(__x86_64__)
  PUSH(BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, 0x40000000, 0, 1));
  PUSH(BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_USER_NOTIF));
#endif
  for (size_t i = 0; i < sizeof(CALLS) / sizeof(CALLS[0]); i++) {
    PUSH(BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (unsigned)CALLS[i].number, 0, 1));
    PUSH(BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_USER_NOTIF));
  }
  PUSH(BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));
#undef PUSH
  struct sock_fprog program = {.len = (unsigned short)n, .filter = code};
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0))
    return -1;
  return (int)syscall(SYS_seccomp, SECCOMP_SET_MODE_FILTER,
                      SECCOMP_FILTER_FLAG_NEW_LISTENER, &program);
}

static void task_identity(pid_t tid, unsigned long *tgid, unsigned long *ppid,
                          Bytes *status) {
  char path[96];
  snprintf(path, sizeof(path), "/proc/%d/status", tid);
  *status = read_file(path, 16384);
  *tgid = *ppid = 0;
  if (!good(status))
    return;
  char text[16385];
  memcpy(text, status->data, status->size);
  text[status->size] = 0;
  char *line = strstr(text, "\nTgid:");
  if (line)
    *tgid = strtoul(line + 6, NULL, 10);
  line = strstr(text, "\nPPid:");
  if (line)
    *ppid = strtoul(line + 6, NULL, 10);
}
static unsigned long long process_birth(unsigned long pid) {
  char path[96], text[16385];
  snprintf(path, sizeof(path), "/proc/%lu/stat", pid);
  Bytes value = read_file(path, 16384);
  if (!good(&value))
    return 0;
  memcpy(text, value.data, value.size);
  text[value.size] = 0;
  char *after = strrchr(text, ')');
  if (!after || after[1] != ' ')
    return 0;
  char *saved = NULL, *token = strtok_r(after + 2, " ", &saved);
  for (unsigned field = 3; token && field < 22; field++)
    token = strtok_r(NULL, " ", &saved);
  return token ? strtoull(token, NULL, 10) : 0;
}
static Bytes descriptor_target(pid_t tid, uint64_t raw) {
  int fd = (int)raw;
  Bytes value;
  if (fd == AT_FDCWD)
    value = proc_link(tid, "cwd");
  else {
    char member[48];
    snprintf(member, sizeof(member), "fd/%d", fd);
    value = proc_link(tid, member);
  }
  return value;
}
static void attempt_json(int listener, const struct seccomp_notif *request) {
  const Call *call = NULL;
  if (request->data.arch == OBSERVER_ARCH)
    for (size_t i = 0; i < sizeof(CALLS) / sizeof(CALLS[0]); i++)
      if (CALLS[i].number == request->data.nr) {
        call = &CALLS[i];
        break;
      }
  if (!call) {
    record_error("unsupported syscall ABI", EPROTONOSUPPORT);
    return;
  }
  unsigned long tgid, ppid;
  Bytes status, cwd = proc_link(request->pid, "cwd"),
                image = proc_link(request->pid, "exe");
  task_identity(request->pid, &tgid, &ppid, &status);
  unsigned long long birth = process_birth(tgid),
                     parent_birth = ppid ? process_birth(ppid) : 0;
  bool complete = good(&cwd) && good(&image) && good(&status) && tgid && birth;
  Bytes argv = {0};
  bool argv_read = false;
  if (image.size >= 8 &&
      memcmp(image.data + image.size - 8, "/rustdoc", 8) == 0) {
    char path[96];
    snprintf(path, sizeof(path), "/proc/%lu/cmdline", tgid);
    argv = read_file(path, ARGV_BYTES);
    argv_read = true;
    complete = complete && good(&argv);
  }
  Bytes paths[2];
  for (unsigned i = 0; i < call->count; i++) {
    paths[i] = remote_path(request->pid, request->data.args[call->paths[i]]);
    complete = complete && good(&paths[i]);
  }
  Bytes descriptors[2];
  for (unsigned i = 0; i < (call->count ? call->count : 1); i++) {
    if (call->dirfds[i] < 0)
      continue;
    int fd = (int)request->data.args[call->dirfds[i]];
    descriptors[i] =
        descriptor_target(request->pid, request->data.args[call->dirfds[i]]);
    if (fd >= 0 || fd == AT_FDCWD)
      complete = complete && good(&descriptors[i]);
  }
  bool canceled =
      ioctl(listener, SECCOMP_IOCTL_NOTIF_ID_VALID, &request->id) < 0;
  if (canceled && errno != ENOENT) {
    record_error("validate notification", errno);
    complete = false;
  }
  fprintf(output,
          "{\"kind\":\"attempt\",\"id\":\"%llu\",\"tid\":%d,\"tgid\":%lu,"
          "\"ppid\":%lu,\"birth\":\"%llu\",\"parentBirth\":\"%llu\","
          "\"syscall\":\"%s\",\"operation\":\"%s\",\"outcome\":\"unknown\","
          "\"canceled\":%s,\"factsComplete\":%s,\"args\":[",
          (unsigned long long)request->id, request->pid, tgid, ppid, birth,
          parent_birth, call->name, call->operation,
          canceled ? "true" : "false", complete ? "true" : "false");
  for (unsigned i = 0; i < 6; i++)
    fprintf(output, "%s\"%llx\"", i ? "," : "",
            (unsigned long long)request->data.args[i]);
  fputs("],\"cwd\":", output);
  bytes_json(&cwd);
  fputs(",\"image\":", output);
  bytes_json(&image);
  fprintf(output, ",\"argvRead\":%s,\"argv\":", argv_read ? "true" : "false");
  bytes_json(&argv);
  fputs(",\"paths\":[", output);
  for (unsigned i = 0; i < call->count; i++) {
    if (i)
      fputc(',', output);
    fprintf(output, "{\"arg\":%d,\"dirfdArg\":%d,\"value\":", call->paths[i],
            call->dirfds[i]);
    bytes_json(&paths[i]);
    fputc('}', output);
  }
  fputs("],\"dirfds\":[", output);
  bool comma = false;
  for (unsigned i = 0; i < (call->count ? call->count : 1); i++)
    if (call->dirfds[i] >= 0) {
      if (comma)
        fputc(',', output);
      comma = true;
      fprintf(output, "{\"arg\":%d,\"fd\":%d,\"target\":", call->dirfds[i],
              (int)request->data.args[call->dirfds[i]]);
      bytes_json(&descriptors[i]);
      fputc('}', output);
    }
  fputs("]}\n", output);
  attempts++;
  if (!complete && !canceled)
    errors++;
  check_output();
}
static void inherited_descriptors(void) {
  DIR *directory = opendir("/proc/self/fd");
  if (!directory)
    fatal("inherited descriptors");
  unsigned count = 0;
  struct dirent *entry;
  while ((entry = readdir(directory))) {
    char *end;
    long fd = strtol(entry->d_name, &end, 10);
    if (*end || fd < 0 || fd == dirfd(directory) || fd == fileno(output))
      continue;
    int descriptor_flags = fcntl((int)fd, F_GETFD),
        flags = fcntl((int)fd, F_GETFL);
    if (descriptor_flags < 0 || flags < 0)
      fatal("inherited descriptor flags");
    if (descriptor_flags & FD_CLOEXEC)
      continue;
    if (++count > 4096) {
      errno = EOVERFLOW;
      fatal("inherited descriptor count");
    }
    char path[96];
    snprintf(path, sizeof(path), "/proc/self/fd/%ld", fd);
    Bytes target = read_link(path);
    if (!good(&target))
      errors++;
    fprintf(output,
            "{\"kind\":\"inherited\",\"fd\":%ld,\"flags\":%d,\"target\":", fd,
            flags);
    bytes_json(&target);
    fputs("}\n", output);
  }
  closedir(directory);
}
static volatile sig_atomic_t signal_to_forward;
static volatile sig_atomic_t terminal_signal;
static void wake_signal(int signal) {
  if (signal != SIGCHLD) {
    signal_to_forward = signal;
    terminal_signal = signal;
  }
}
static void forward_pending(pid_t root, bool reaped) {
  int signal = signal_to_forward;
  if (!signal)
    return;
  signal_to_forward = 0;
  fprintf(output, "{\"kind\":\"signal\",\"signal\":%d,\"rootAlive\":%s}\n",
          signal, reaped ? "false" : "true");
  if (fflush(output))
    output_failed = true;
  if (!reaped)
    kill(root, signal);
}
static void child_error(int fd, int stage) {
  ChildError value = {.stage = stage, .error = errno};
  (void)write(fd, &value, sizeof(value));
  _exit(127);
}

int main(int argc, char **argv) {
  if (argc < 4 || strcmp(argv[2], "--")) {
    fputs("usage: file-input-observer <record> -- <command> [args...]\n",
          stderr);
    return 2;
  }
  int logfd = open(argv[1], O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  if (logfd < 0)
    fatal("create observation");
  output = fdopen(logfd, "w");
  if (!output)
    fatal("observation stream");
  static char buffer[65536];
  if (setvbuf(output, buffer, _IOFBF, sizeof(buffer)))
    fatal("observation buffer");
  fputs("{\"kind\":\"start\",\"version\":2,\"mechanism\":\"seccomp-user-"
        "notification\",\"noNewPrivileges\":true}\n",
        output);
  inherited_descriptors();
  sigset_t blocked, original, waiting;
  sigemptyset(&blocked);
  const int signals[] = {SIGCHLD, SIGINT, SIGTERM, SIGHUP};
  struct sigaction previous[4], action = {0};
  action.sa_handler = wake_signal;
  sigemptyset(&action.sa_mask);
  for (unsigned i = 0; i < 4; i++)
    sigaddset(&blocked, signals[i]);
  if (sigprocmask(SIG_BLOCK, &blocked, &original))
    fatal("block supervisor signals");
  waiting = original;
  for (unsigned i = 0; i < 4; i++) {
    sigdelset(&waiting, signals[i]);
    if (sigaction(signals[i], &action, &previous[i]))
      fatal("supervisor signal handler");
  }
  int pair[2], exec_error[2];
  if (socketpair(AF_UNIX, SOCK_SEQPACKET | SOCK_CLOEXEC, 0, pair) ||
      pipe2(exec_error, O_CLOEXEC))
    fatal("private handoff");
  // Orphaned descendants must remain beneath this observer: otherwise Linux's
  // ancestor check can revoke process_vm_readv before their last operation.
  // Reap them here as well, so filter HUP proves the complete lifetime drained.
  if (prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0))
    fatal("descendant lifetime ownership");
  uint64_t startup = now_ns();
  pid_t root = fork();
  if (root < 0)
    fatal("fork");
  if (!root) {
    close(pair[0]);
    close(exec_error[0]);
    close(logfd);
    for (unsigned i = 0; i < 4; i++)
      if (sigaction(signals[i], &previous[i], NULL))
        child_error(exec_error[1], 1);
    if (sigprocmask(SIG_SETMASK, &original, NULL))
      child_error(exec_error[1], 1);
    int listener = install_filter();
    if (listener < 0)
      child_error(exec_error[1], 2);
    if (pass_fd(pair[1], listener))
      child_error(exec_error[1], 3);
    close(listener);
    close(pair[1]);
    execvp(argv[3], argv + 3);
    child_error(exec_error[1], 4);
  }
  fprintf(output, "{\"kind\":\"root-start\",\"root\":%d}\n", root);
  close(pair[1]);
  close(exec_error[1]);
  struct pollfd handoff = {.fd = pair[0], .events = POLLIN};
  int listener = -1;
  for (;;) {
    int timeout = phase_timeout_ms(true, now_ns() - startup);
    if (!timeout) {
      errno = ETIMEDOUT;
      fatal("wedged listener handoff");
    }
    struct timespec duration = {.tv_sec = timeout / 1000,
                                .tv_nsec = (timeout % 1000) * 1000000L};
    int ready = ppoll(&handoff, 1, &duration, &waiting);
    if (ready < 0 && errno == EINTR) {
      forward_pending(root, false);
      continue;
    }
    if (ready < 0)
      fatal("listener handoff poll");
    if (!ready)
      continue;
    listener = receive_fd(pair[0]);
    break;
  }
  close(pair[0]);
  ChildError launch_error = {0};
  if (listener < 0) {
    (void)read(exec_error[0], &launch_error, sizeof(launch_error));
    close(exec_error[0]);
    int status;
    while (waitpid(root, &status, 0) < 0 && errno == EINTR) {
    }
    fprintf(output,
            "{\"kind\":\"complete\",\"complete\":false,\"entered\":false,"
            "\"root\":%d,\"exit\":-1,\"signal\":0,\"attempts\":0,\"errors\":1,"
            "\"drainComplete\":true,\"observerSignal\":%d,\"stage\":%d,"
            "\"execErrno\":%d}\n",
            root, terminal_signal, launch_error.stage, launch_error.error);
    fclose(output);
    fprintf(stderr,
            "file input observer: listener setup failed at stage %d: %s\n",
            launch_error.stage, strerror(launch_error.error));
    return 2;
  }
  struct seccomp_notif_sizes sizes = {0};
  if (syscall(SYS_seccomp, SECCOMP_GET_NOTIF_SIZES, 0, &sizes))
    fatal("notification ABI sizes");
  struct seccomp_notif *request = calloc(1, sizes.seccomp_notif);
  struct seccomp_notif_resp *response = calloc(1, sizes.seccomp_notif_resp);
  if (!request || !response)
    fatal("notification buffers");
  int flags = fcntl(exec_error[0], F_GETFL);
  if (flags < 0 || fcntl(exec_error[0], F_SETFL, flags | O_NONBLOCK))
    fatal("exec error channel");
  bool reaped = false, drained = false, entered = false, error_closed = false;
  uint64_t ended = 0;
  int root_status = 0;
  while (!drained) {
    forward_pending(root, reaped);
    if (!error_closed) {
      ssize_t n = read(exec_error[0], &launch_error, sizeof(launch_error));
      if (!n) {
        entered = launch_error.stage == 0;
        error_closed = true;
        close(exec_error[0]);
      } else if (n == sizeof(launch_error)) {
        error_closed = true;
        close(exec_error[0]);
      } else if (n >= 0 || (errno != EAGAIN && errno != EINTR)) {
        record_error("exec error channel", n < 0 ? errno : EPROTO);
        error_closed = true;
        close(exec_error[0]);
      }
    }
    for (;;) {
      int status = 0;
      pid_t child = waitpid(-1, &status, WNOHANG);
      if (child == root) {
        root_status = status;
        reaped = true;
        ended = now_ns();
        fprintf(
            output,
            "{\"kind\":\"root-exit\",\"root\":%d,\"exit\":%d,\"signal\":%d}\n",
            root, WIFEXITED(root_status) ? WEXITSTATUS(root_status) : -1,
            WIFSIGNALED(root_status) ? WTERMSIG(root_status) : 0);
        if (fflush(output))
          output_failed = true;
      } else if (child < 0 && errno != EINTR && errno != ECHILD)
        fatal("wait observed root");
      if (child <= 0)
        break;
    }
    int timeout = phase_timeout_ms(reaped, reaped ? now_ns() - ended : 0);
    if (!timeout) {
      record_error("wedged descendant drain after root exit", ETIMEDOUT);
      break;
    }
    struct timespec duration = {
        .tv_sec = timeout < 0 ? 0 : timeout / 1000,
        .tv_nsec = timeout < 0 ? 0 : (timeout % 1000) * 1000000L};
    struct pollfd poller = {.fd = listener, .events = POLLIN};
    int ready = ppoll(&poller, 1, timeout < 0 ? NULL : &duration, &waiting);
    if (ready < 0) {
      if (errno == EINTR)
        continue;
      fatal("notification poll");
    }
    if (!ready)
      continue;
    if (poller.revents & POLLHUP) {
      drained = true;
      break;
    }
    if (poller.revents & POLLIN) {
      memset(request, 0, sizes.seccomp_notif);
      if (ioctl(listener, SECCOMP_IOCTL_NOTIF_RECV, request)) {
        if (errno == EINTR || errno == ENOENT)
          continue;
        fatal("receive notification");
      }
      attempt_json(listener, request);
      memset(response, 0, sizes.seccomp_notif_resp);
      response->id = request->id;
      response->flags = SECCOMP_USER_NOTIF_FLAG_CONTINUE;
      if (ioctl(listener, SECCOMP_IOCTL_NOTIF_SEND, response) &&
          errno != ENOENT)
        fatal("continue observed syscall");
    }
  }
  if (!reaped) {
    while (waitpid(root, &root_status, 0) < 0)
      if (errno != EINTR)
        fatal("reap observed root");
    fprintf(output,
            "{\"kind\":\"root-exit\",\"root\":%d,\"exit\":%d,\"signal\":%d}\n",
            root, WIFEXITED(root_status) ? WEXITSTATUS(root_status) : -1,
            WIFSIGNALED(root_status) ? WTERMSIG(root_status) : 0);
  }
  if (!error_closed) {
    ssize_t n = read(exec_error[0], &launch_error, sizeof(launch_error));
    if (!n)
      entered = true;
    else if (n != sizeof(launch_error))
      record_error("final exec error channel", n < 0 ? errno : EPROTO);
    close(exec_error[0]);
  }
  close(listener);
  free(request);
  free(response);
  check_output();
  bool complete = drained && !errors && !output_failed;
  fprintf(output,
          "{\"kind\":\"complete\",\"complete\":%s,\"root\":%d,\"entered\":%s,"
          "\"execErrno\":%d,\"exit\":%d,\"signal\":%d,\"attempts\":%lu,"
          "\"errors\":%lu,\"drainComplete\":%s,\"observerSignal\":%d}\n",
          complete ? "true" : "false", root, entered ? "true" : "false",
          launch_error.error,
          WIFEXITED(root_status) ? WEXITSTATUS(root_status) : -1,
          WIFSIGNALED(root_status) ? WTERMSIG(root_status) : 0, attempts,
          errors, drained ? "true" : "false", terminal_signal);
  if (fclose(output))
    complete = false;
  if ((!complete || launch_error.error) && !terminal_signal) {
    fprintf(stderr,
            "file input observer: incomplete census (root %d, %lu fact errors, "
            "drain %s, exec errno %d)\n",
            root, errors, drained ? "complete" : "incomplete",
            launch_error.error);
    return 2;
  }
  if (terminal_signal || WIFSIGNALED(root_status)) {
    int signal = terminal_signal ? terminal_signal : WTERMSIG(root_status);
    struct sigaction action_default = {0};
    action_default.sa_handler = SIG_DFL;
    sigemptyset(&action_default.sa_mask);
    sigaction(signal, &action_default, NULL);
    sigprocmask(SIG_SETMASK, &original, NULL);
    raise(signal);
    return 128 + signal;
  }
  return WEXITSTATUS(root_status);
}
