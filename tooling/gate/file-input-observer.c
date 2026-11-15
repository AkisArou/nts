/* Observation, not access control. Notifications describe attempts; CONTINUE
 * supplies no return value. No pathname or image is treated as authorization.
 * https://docs.kernel.org/userspace-api/seccomp_filter.html */
#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/fs.h>
#include <linux/magic.h>
#include <linux/seccomp.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/auxv.h>
#include <sys/ioctl.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/uio.h>
#include <sys/vfs.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include <zlib.h>

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
  unsigned char *data;
  size_t size;
  int error;
  bool truncated, null;
} Bytes;
typedef struct {
  int stage, error;
} ChildError;
static FILE *output;
static gzFile compressed;
static int observation_fd;
static char *pending_path;
static unsigned long errors, attempts;
static bool output_failed;
static FILE *image_reader;
static const char *image_reader_recipe;
enum { IMAGE_REPLY_BYTES = 512 * 1024 };
static char image_reply[IMAGE_REPLY_BYTES];

static ssize_t compressed_write(void *cookie, const char *bytes, size_t size) {
  if (size > INT32_MAX) {
    errno = EOVERFLOW;
    return -1;
  }
  int written = gzwrite((gzFile)cookie, bytes, (unsigned)size);
  if (!written && size) {
    errno = EIO;
    return -1;
  }
  return written;
}
static int compressed_close(void *cookie) {
  if (gzclose((gzFile)cookie) == Z_OK)
    return 0;
  errno = EIO;
  return -1;
}
static void flush_output(void) {
  // Only lifecycle barriers need visibility before final publication.
  if (fflush(output) || gzflush(compressed, Z_SYNC_FLUSH) != Z_OK)
    output_failed = true;
}
static bool publish_observation(const char *path) {
  if (fclose(output)) {
    fprintf(stderr,
            "file input observer: compressed artifact close failed: %s\n",
            strerror(errno));
    return false;
  }
  // The final name stays absent until compression has closed successfully.
  // NOREPLACE also refuses two writers rather than replacing either artifact.
  if (syscall(SYS_renameat2, AT_FDCWD, pending_path, AT_FDCWD, path,
              RENAME_NOREPLACE)) {
    fprintf(stderr, "file input observer: publish compressed artifact: %s\n",
            strerror(errno));
    return false;
  }
  free(pending_path);
  return true;
}

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
static Bytes read_link(const char *path, unsigned char data[PATH_BYTES]) {
  Bytes b = {.data = data};
  ssize_t n = readlink(path, (char *)b.data, PATH_BYTES);
  if (n < 0)
    b.error = errno;
  else {
    b.size = (size_t)n;
    b.truncated = n == PATH_BYTES;
  }
  return b;
}
static Bytes proc_link(pid_t tid, const char *member,
                       unsigned char data[PATH_BYTES]) {
  char path[96];
  snprintf(path, sizeof(path), "/proc/%d/%s", tid, member);
  return read_link(path, data);
}
static Bytes read_file(const char *path, unsigned char *data, size_t limit) {
  Bytes b = {.data = data};
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
static Bytes remote_path(pid_t tid, uint64_t address,
                         unsigned char data[PATH_BYTES]) {
  Bytes b = {.data = data};
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
/* Read the stopped exec request, never a later /proc cmdline. Missing vectors
 * remain facts about this request; they do not invent an empty invocation. */
static Bytes remote_argv(pid_t tid, uint64_t address,
                         unsigned char data[ARGV_BYTES]) {
  Bytes result = {.data = data};
  if (!address) {
    result.null = true;
    return result;
  }
  for (size_t i = 0; result.size < ARGV_BYTES; i++) {
    uint64_t pointer;
    if (address > UINT64_MAX - i * sizeof(pointer)) {
      result.error = EOVERFLOW;
      return result;
    }
    struct iovec local = {.iov_base = &pointer, .iov_len = sizeof(pointer)};
    struct iovec remote = {
        .iov_base = (void *)(uintptr_t)(address + i * sizeof(pointer)),
        .iov_len = sizeof(pointer)};
    ssize_t n;
    do {
      n = process_vm_readv(tid, &local, 1, &remote, 1, 0);
    } while (n < 0 && errno == EINTR);
    if (n != (ssize_t)sizeof(pointer)) {
      result.error = n < 0 ? errno : EFAULT;
      return result;
    }
    if (!pointer)
      return result;
    unsigned char argument[PATH_BYTES];
    Bytes value = remote_path(tid, pointer, argument);
    if (!good(&value) || value.null) {
      result.error = value.error;
      result.truncated = value.truncated;
      result.null = value.null;
      return result;
    }
    if (value.size + 1 > ARGV_BYTES - result.size) {
      result.truncated = true;
      return result;
    }
    memcpy(data + result.size, value.data, value.size);
    result.size += value.size;
    data[result.size++] = 0;
  }
  result.truncated = true;
  return result;
}
static Bytes exec_target(const struct seccomp_notif *request, const Call *call,
                         const Bytes *path, unsigned char data[PATH_BYTES]) {
  Bytes result = {.data = data};
  if (!good(path) || path->null) {
    result.error = path->error ? path->error : EFAULT;
    result.truncated = path->truncated;
    return result;
  }
  char spelling[PATH_BYTES + 128];
  if (!path->size) {
    if (strcmp(call->name, "execveat") ||
        !(request->data.args[4] & AT_EMPTY_PATH)) {
      result.error = ENOENT;
      return result;
    }
    snprintf(spelling, sizeof(spelling), "/proc/%d/fd/%d", request->pid,
             (int)request->data.args[0]);
  } else if (path->data[0] == '/')
    snprintf(spelling, sizeof(spelling), "/proc/%d/root/%.*s", request->pid,
             (int)path->size, path->data);
  else if (!strcmp(call->name, "execveat") &&
           (int)request->data.args[0] != AT_FDCWD)
    snprintf(spelling, sizeof(spelling), "/proc/%d/fd/%d/%.*s", request->pid,
             (int)request->data.args[0], (int)path->size, path->data);
  else
    snprintf(spelling, sizeof(spelling), "/proc/%d/cwd/%.*s", request->pid,
             (int)path->size, path->data);
  char *physical = realpath(spelling, NULL);
  if (!physical) {
    result.error = errno;
    return result;
  }
  result.size = strlen(physical);
  if (result.size >= PATH_BYTES) {
    result.size = PATH_BYTES;
    result.truncated = true;
  }
  memcpy(data, physical, result.size);
  free(physical);
  return result;
}

/* Capture resolution while the task is stopped. This is metadata evidence,
 * never the notified syscall's return. Unshared mount/root namespaces and
 * bounded-walk failures remain explicitly unavailable. No ABI flags are
 * decoded: a final symlink is labelled, so a no-follow consumer can decline
 * this proof. */
enum { RESOLUTION_COMPONENTS = 128, RESOLUTION_PATH_BYTES = 16384 };
typedef struct {
  char path[PATH_BYTES], link[PATH_BYTES];
  const char *kind, *filesystem;
  bool task_anchor;
  unsigned long long dev, ino;
} ResolutionComponent;
typedef struct {
  int error;
  const char *state;
  bool final_link, final_component, task_anchored;
  pid_t tid;
  unsigned long tgid;
  unsigned count, path_bytes;
  char path[PATH_BYTES];
  struct stat mount, root, task_pid_namespace, observer_pid_namespace,
      proc_root;
  ResolutionComponent components[RESOLUTION_COMPONENTS];
} PathResolution;
static PathResolution resolution_rows[2];
static unsigned long resolution_walks, resolution_stats;
static bool same_identity(const struct stat *left, const struct stat *right) {
  return left->st_dev == right->st_dev && left->st_ino == right->st_ino;
}
static bool proc_anchor_identity(const struct stat *task_pid,
                                 const struct stat *observer_pid,
                                 const struct stat *walked_root,
                                 const struct stat *observer_root) {
  return same_identity(task_pid, observer_pid) &&
         same_identity(walked_root, observer_root);
}
static bool proc_anchor_fence(PathResolution *value, const char *parent,
                              bool acquire) {
  char path[96];
  struct stat task_pid, observer_pid, walked_root, observer_root;
  snprintf(path, sizeof(path), "/proc/%d/ns/pid", value->tid);
  if (stat(path, &task_pid) || stat("/proc/self/ns/pid", &observer_pid) ||
      lstat(parent, &walked_root) || lstat("/proc", &observer_root)) {
    value->error = errno;
    return false;
  }
  if (!S_ISDIR(walked_root.st_mode) || !S_ISDIR(observer_root.st_mode) ||
      !proc_anchor_identity(&task_pid, &observer_pid, &walked_root,
                            &observer_root) ||
      (!acquire &&
       (!same_identity(&task_pid, &value->task_pid_namespace) ||
        !same_identity(&observer_pid, &value->observer_pid_namespace) ||
        !same_identity(&walked_root, &value->proc_root)))) {
    value->error = EXDEV;
    return false;
  }
  if (acquire) {
    value->task_pid_namespace = task_pid;
    value->observer_pid_namespace = observer_pid;
    value->proc_root = walked_root;
  }
  return true;
}
static bool resolution_namespace(pid_t tid, struct stat *mount,
                                 struct stat *root) {
  char path[96];
  struct stat own_mount, own_root;
  snprintf(path, sizeof(path), "/proc/%d/ns/mnt", tid);
  if (stat(path, mount) || stat("/proc/self/ns/mnt", &own_mount))
    return false;
  snprintf(path, sizeof(path), "/proc/%d/root", tid);
  if (stat(path, root) || stat("/", &own_root))
    return false;
  return mount->st_dev == own_mount.st_dev &&
         mount->st_ino == own_mount.st_ino && root->st_dev == own_root.st_dev &&
         root->st_ino == own_root.st_ino;
}
static bool resolution_component(PathResolution *value, const char *path,
                                 struct stat *info) {
  size_t size = strlen(path);
  if (value->count == RESOLUTION_COMPONENTS ||
      value->path_bytes + size > RESOLUTION_PATH_BYTES) {
    value->error = EOVERFLOW;
    return false;
  }
  ResolutionComponent *part = &value->components[value->count++];
  memcpy(part->path, path, size + 1);
  part->link[0] = 0;
  part->filesystem = NULL;
  part->task_anchor = false;
  value->path_bytes += (unsigned)size;
  resolution_stats++;
  if (lstat(path, info)) {
    value->error = errno;
    part->kind = "missing";
    part->dev = part->ino = 0;
    if (errno == ENOENT) {
      value->state = "missing";
      value->error = 0;
    }
    return false;
  }
  part->dev = (unsigned long long)info->st_dev;
  part->ino = (unsigned long long)info->st_ino;
  part->kind = S_ISDIR(info->st_mode)   ? "directory"
               : S_ISREG(info->st_mode) ? "file"
               : S_ISLNK(info->st_mode) ? "symlink"
                                        : "other";
  const ResolutionComponent *previous =
      value->count > 1 ? &value->components[value->count - 2] : NULL;
  if (previous && previous->dev == part->dev)
    part->filesystem = previous->filesystem;
  else if (!S_ISLNK(info->st_mode) && info->st_dev != value->root.st_dev) {
    struct statfs filesystem;
    if (statfs(path, &filesystem)) {
      value->error = errno;
      return false;
    }
    if (filesystem.f_type == PROC_SUPER_MAGIC)
      part->filesystem = "procfs";
    else if (filesystem.f_type == SYSFS_MAGIC)
      part->filesystem = "sysfs";
  }
  return true;
}
static void resolution_parent(char *path) {
  char *slash = strrchr(path, '/');
  if (slash == path)
    path[1] = 0;
  else if (slash)
    *slash = 0;
}
static void resolve_attempt_path(pid_t tid, unsigned long tgid,
                                 const Bytes *path, const Bytes *anchor,
                                 PathResolution *value) {
  value->error = EINVAL;
  value->state = "unavailable";
  value->count = value->path_bytes = 0;
  value->final_link = false;
  value->final_component = value->task_anchored = false;
  value->tid = tid;
  value->tgid = tgid;
  value->path[0] = 0;
  if (!good(path) || path->null || !path->size || path->size >= PATH_BYTES)
    return;
  resolution_walks++;
  if (!resolution_namespace(tid, &value->mount, &value->root)) {
    value->error = EXDEV;
    return;
  }
  if (path->data[0] == '/')
    strcpy(value->path, "/");
  else {
    if (!anchor || !good(anchor) || anchor->null || !anchor->size ||
        anchor->size >= PATH_BYTES || anchor->data[0] != '/')
      return;
    memcpy(value->path, anchor->data, anchor->size);
    value->path[anchor->size] = 0;
  }
  char pending[PATH_BYTES];
  memcpy(pending, path->data, path->size);
  pending[path->size] = 0;
  bool directory_required = path->data[path->size - 1] == '/';
  unsigned links = 0;
  struct stat info;
  value->error = 0;
  if (!resolution_component(value, value->path, &info))
    goto done;
  if (!S_ISDIR(info.st_mode)) {
    value->state = "not-directory";
    goto done;
  }
  while (*pending) {
    char part[PATH_BYTES];
    char *start = pending;
    while (*start == '/')
      start++;
    if (!*start)
      break;
    char *end = strchr(start, '/');
    size_t size = end ? (size_t)(end - start) : strlen(start);
    memcpy(part, start, size);
    part[size] = 0;
    memmove(pending, end ? end + 1 : start + size,
            strlen(end ? end + 1 : start + size) + 1);
    char *tail = pending;
    while (*tail == '/')
      tail++;
    bool final = !*tail;
    value->final_component = final;
    if (!strcmp(part, "."))
      continue;
    if (!strcmp(part, ".."))
      resolution_parent(value->path);
    else {
      size_t before = strlen(value->path);
      if (before + size + 2 >= PATH_BYTES) {
        value->error = ENAMETOOLONG;
        break;
      }
      if (before != 1)
        strcat(value->path, "/");
      strcat(value->path, part);
    }
    if (!resolution_component(value, value->path, &info))
      break;
    if (S_ISLNK(info.st_mode)) {
      char parent[PATH_BYTES];
      strcpy(parent, value->path);
      resolution_parent(parent);
      struct statfs filesystem;
      if (statfs(parent, &filesystem)) {
        value->error = errno;
        break;
      }
      if (filesystem.f_type == PROC_SUPER_MAGIC) {
        // self/thread-self are task-directory anchors only with a tail.
        // Their numeric meaning is fenced by both PID namespace and procfs
        // root identity. Other magic links never borrow observer identity.
        if (final || !tgid ||
            (strcmp(part, "self") && strcmp(part, "thread-self"))) {
          value->error = EOPNOTSUPP;
          break;
        }
        if (!proc_anchor_fence(value, parent, !value->task_anchored))
          break;
        if (++links > 40) {
          value->error = ELOOP;
          break;
        }
        ResolutionComponent *component = &value->components[value->count - 1];
        component->task_anchor = true;
        component->filesystem = "procfs";
        value->task_anchored = true;
        int written = !strcmp(part, "self")
                          ? snprintf(value->path, sizeof(value->path), "%s/%lu",
                                     parent, tgid)
                          : snprintf(value->path, sizeof(value->path),
                                     "%s/%lu/task/%d", parent, tgid, tid);
        if (written < 0 || written >= PATH_BYTES) {
          value->error = ENAMETOOLONG;
          break;
        }
        if (!resolution_component(value, value->path, &info))
          break;
        if (!S_ISDIR(info.st_mode)) {
          value->state = "not-directory";
          break;
        }
        continue;
      }
      ResolutionComponent *component = &value->components[value->count - 1];
      ssize_t count = readlink(value->path, component->link, PATH_BYTES - 1);
      if (count < 0) {
        value->error = errno;
        break;
      }
      if (count == PATH_BYTES - 1 || ++links > 40) {
        value->error = ELOOP;
        break;
      }
      component->link[count] = 0;
      value->path_bytes += (unsigned)count;
      if (value->path_bytes > RESOLUTION_PATH_BYTES) {
        value->error = EOVERFLOW;
        break;
      }
      value->final_link = value->final_link || final;
      if (final && count && component->link[count - 1] == '/')
        directory_required = true;
      char next[PATH_BYTES];
      int written = snprintf(next, sizeof(next), "%s%s%s", component->link,
                             *pending ? "/" : "", pending);
      if (written < 0 || written >= PATH_BYTES) {
        value->error = ENAMETOOLONG;
        break;
      }
      if (component->link[0] == '/')
        strcpy(value->path, "/");
      else
        resolution_parent(value->path);
      strcpy(pending, next);
    } else if ((!final || directory_required) && !S_ISDIR(info.st_mode)) {
      value->state = "not-directory";
      break;
    }
  }
  if (!value->error && !strcmp(value->state, "unavailable"))
    value->state = "resolved";
  if (!value->error && !*pending)
    value->final_component = true;
done:;
  struct stat mount, root;
  if (!resolution_namespace(tid, &mount, &root) ||
      mount.st_dev != value->mount.st_dev ||
      mount.st_ino != value->mount.st_ino ||
      root.st_dev != value->root.st_dev || root.st_ino != value->root.st_ino)
    value->error = EXDEV;
  if (value->task_anchored)
    for (unsigned i = 0; i < value->count; i++)
      if (value->components[i].task_anchor) {
        char parent[PATH_BYTES];
        strcpy(parent, value->components[i].path);
        resolution_parent(parent);
        if (!proc_anchor_fence(value, parent, false))
          break;
      }
}
static void resolution_text(const char *text) {
  Bytes value = {.data = (unsigned char *)text, .size = strlen(text)};
  bytes_json(&value);
}
static void resolution_json(const PathResolution *value) {
  if (value->error) {
    fprintf(output, "{\"state\":\"unavailable\",\"error\":%d}", value->error);
    return;
  }
  fprintf(
      output,
      "{\"state\":\"%s\",\"finalLink\":%s,\"finalComponent\":%s,\"namespace\":{"
      "\"dev\":\"%llu\","
      "\"ino\":\"%llu\",\"rootDev\":\"%llu\",\"rootIno\":\"%llu\"},\"path\":",
      value->state, value->final_link ? "true" : "false",
      value->final_component ? "true" : "false",
      (unsigned long long)value->mount.st_dev,
      (unsigned long long)value->mount.st_ino,
      (unsigned long long)value->root.st_dev,
      (unsigned long long)value->root.st_ino);
  resolution_text(value->path);
  fputs(",\"components\":[", output);
  for (unsigned i = 0; i < value->count; i++) {
    const ResolutionComponent *part = &value->components[i];
    if (i)
      fputc(',', output);
    fputs("{\"path\":", output);
    resolution_text(part->path);
    fprintf(output, ",\"kind\":\"%s\",\"dev\":\"%llu\",\"ino\":\"%llu\"",
            part->kind, part->dev, part->ino);
    if (part->filesystem)
      fprintf(output, ",\"filesystem\":\"%s\"", part->filesystem);
    if (part->task_anchor)
      fprintf(
          output,
          ",\"taskAnchor\":{\"kind\":\"procfs-task\",\"tid\":%d,\"tgid\":%lu,"
          "\"taskPidNamespace\":{\"dev\":\"%llu\",\"ino\":\"%llu\"},"
          "\"observerPidNamespace\":{\"dev\":\"%llu\",\"ino\":\"%llu\"},"
          "\"procRoot\":{\"dev\":\"%llu\",\"ino\":\"%llu\"}}",
          value->tid, value->tgid,
          (unsigned long long)value->task_pid_namespace.st_dev,
          (unsigned long long)value->task_pid_namespace.st_ino,
          (unsigned long long)value->observer_pid_namespace.st_dev,
          (unsigned long long)value->observer_pid_namespace.st_ino,
          (unsigned long long)value->proc_root.st_dev,
          (unsigned long long)value->proc_root.st_ino);
    if (*part->link) {
      fputs(",\"link\":", output);
      resolution_text(part->link);
    }
    fputc('}', output);
  }
  fputs("]}", output);
}
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
                          Bytes *status, unsigned char data[16384]) {
  char path[96];
  snprintf(path, sizeof(path), "/proc/%d/status", tid);
  *status = read_file(path, data, 16384);
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
  Bytes value = read_file(path, (unsigned char *)text, sizeof(text) - 1);
  if (!good(&value))
    return 0;
  text[value.size] = 0;
  char *after = strrchr(text, ')');
  if (!after || after[1] != ' ')
    return 0;
  char *saved = NULL, *token = strtok_r(after + 2, " ", &saved);
  for (unsigned field = 3; token && field < 22; field++)
    token = strtok_r(NULL, " ", &saved);
  return token ? strtoull(token, NULL, 10) : 0;
}
static Bytes descriptor_target(pid_t tid, uint64_t raw,
                               unsigned char data[PATH_BYTES]) {
  int fd = (int)raw;
  Bytes value;
  if (fd == AT_FDCWD)
    value = proc_link(tid, "cwd", data);
  else {
    char member[48];
    snprintf(member, sizeof(member), "fd/%d", fd);
    value = proc_link(tid, member, data);
  }
  return value;
}
typedef struct TaskImage {
  unsigned long pid;
  unsigned long long birth;
  char path[PATH_BYTES];
  struct TaskImage *next;
} TaskImage;
static TaskImage *task_images[4096];
static bool image_changed(unsigned long pid, unsigned long long birth,
                          const Bytes *image) {
  unsigned bucket = pid % 4096;
  TaskImage *row = task_images[bucket];
  while (row && row->pid != pid)
    row = row->next;
  if (!row) {
    row = calloc(1, sizeof(*row));
    if (!row)
      fatal("image identity allocation");
    row->pid = pid;
    row->next = task_images[bucket];
    task_images[bucket] = row;
  }
  bool changed = row->birth != birth || strlen(row->path) != image->size ||
                 memcmp(row->path, image->data, image->size);
  row->birth = birth;
  memcpy(row->path, image->data, image->size);
  row->path[image->size] = 0;
  return changed;
}
static const char *image_reader_reply(void) {
  struct sigaction ignore = {.sa_handler = SIG_IGN}, previous;
  sigemptyset(&ignore.sa_mask);
  if (sigaction(SIGPIPE, &ignore, &previous))
    return NULL;
  int flushed = fflush(image_reader), saved = errno;
  sigaction(SIGPIPE, &previous, NULL);
  errno = saved;
  if (flushed)
    return NULL;
  uint64_t start = now_ns();
  size_t size = 0;
  while (size + 1 < sizeof(image_reply)) {
    int timeout = phase_timeout_ms(true, now_ns() - start);
    if (!timeout) {
      errno = ETIMEDOUT;
      return NULL;
    }
    struct pollfd response = {.fd = 4, .events = POLLIN};
    if (poll(&response, 1, timeout) <= 0)
      return NULL;
    ssize_t n = read(4, image_reply + size, sizeof(image_reply) - size - 1);
    if (n <= 0) {
      errno = EPIPE;
      return NULL;
    }
    char *end = memchr(image_reply + size, '\n', (size_t)n);
    size += (size_t)n;
    if (end) {
      if (end != image_reply + size - 1) {
        errno = EPROTO;
        return NULL;
      }
      *end = 0;
      return image_reply;
    }
  }
  errno = EOVERFLOW;
  return NULL;
}
static bool image_platform(pid_t tid, unsigned long long *hwcap,
                           unsigned long long *hwcap2) {
  char path[96];
  unsigned char data[16384], platform[PATH_BYTES];
  snprintf(path, sizeof(path), "/proc/%d/auxv", tid);
  Bytes auxv = read_file(path, data, sizeof(data));
  if (!good(&auxv) || auxv.size % 16)
    return false;
  uint64_t pointer = 0, secure = UINT64_MAX;
  bool ended = false;
  *hwcap = *hwcap2 = 0;
  for (size_t offset = 0; offset < auxv.size; offset += 16) {
    uint64_t entry[2];
    memcpy(entry, auxv.data + offset, sizeof(entry));
    if (entry[0] == AT_NULL) {
      ended = true;
      break;
    }
    if (entry[0] == AT_HWCAP)
      *hwcap = entry[1];
    if (entry[0] == AT_HWCAP2)
      *hwcap2 = entry[1];
    if (entry[0] == AT_PLATFORM)
      pointer = entry[1];
    if (entry[0] == AT_SECURE)
      secure = entry[1];
  }
  Bytes task_platform = remote_path(tid, pointer, platform);
  const char *own_platform = (const char *)getauxval(AT_PLATFORM);
  unsigned char own_data[16384];
  Bytes own = read_file("/proc/self/auxv", own_data, sizeof(own_data));
  uint64_t own_hwcap = 0, own_hwcap2 = 0;
  bool own_ended = false;
  if (!good(&own) || own.size % 16)
    return false;
  for (size_t offset = 0; offset < own.size; offset += 16) {
    uint64_t entry[2];
    memcpy(entry, own.data + offset, sizeof(entry));
    if (entry[0] == AT_NULL) {
      own_ended = true;
      break;
    }
    if (entry[0] == AT_HWCAP)
      own_hwcap = entry[1];
    if (entry[0] == AT_HWCAP2)
      own_hwcap2 = entry[1];
  }
  return ended && secure == 0 && good(&task_platform) && !task_platform.null &&
         own_platform && task_platform.size == strlen(own_platform) &&
         !memcmp(task_platform.data, own_platform, task_platform.size) &&
         own_ended && *hwcap == own_hwcap && *hwcap2 == own_hwcap2;
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
  // All facts remain live until this notification is serialized. Their bounded
  // backing storage is independent; only metadata travels through Bytes views.
  unsigned char cwd_data[PATH_BYTES], image_data[PATH_BYTES],
      status_data[16384], argv_data[ARGV_BYTES], target_data[PATH_BYTES],
      path_data[2][PATH_BYTES], descriptor_data[2][PATH_BYTES];
  Bytes status, cwd = proc_link(request->pid, "cwd", cwd_data),
                image = proc_link(request->pid, "exe", image_data);
  task_identity(request->pid, &tgid, &ppid, &status, status_data);
  unsigned long long birth = process_birth(tgid),
                     parent_birth = ppid ? process_birth(ppid) : 0;
  bool complete = good(&cwd) && good(&image) && good(&status) && tgid && birth;
  Bytes argv = {0};
  bool argv_read = false;
  Bytes paths[2];
  for (unsigned i = 0; i < call->count; i++) {
    paths[i] = remote_path(request->pid, request->data.args[call->paths[i]],
                           path_data[i]);
    complete = complete && good(&paths[i]);
  }
  Bytes descriptors[2];
  for (unsigned i = 0; i < (call->count ? call->count : 1); i++) {
    if (call->dirfds[i] < 0)
      continue;
    int fd = (int)request->data.args[call->dirfds[i]];
    descriptors[i] = descriptor_target(
        request->pid, request->data.args[call->dirfds[i]], descriptor_data[i]);
    if (fd >= 0 || fd == AT_FDCWD)
      complete = complete && good(&descriptors[i]);
  }
  bool canceled =
      ioctl(listener, SECCOMP_IOCTL_NOTIF_ID_VALID, &request->id) < 0;
  if (canceled && errno != ENOENT) {
    record_error("validate notification", errno);
    complete = false;
  }
  bool is_exec =
      !strcmp(call->name, "execve") || !strcmp(call->name, "execveat");
  unsigned char environment_data[ARGV_BYTES];
  Bytes requested_argv = {0}, target = {0}, environment = {0};
  if (is_exec) {
    unsigned argument = !strcmp(call->name, "execve") ? 1 : 2;
    requested_argv =
        remote_argv(request->pid, request->data.args[argument], argv_data);
    target = exec_target(request, call, &paths[0], target_data);
    environment = remote_argv(request->pid, request->data.args[argument + 1],
                              environment_data);
  }
  const char *loader_fact = NULL;
  bool namespace_stable = false;
  if (image_reader && complete && image.size < PATH_BYTES) {
    bool changed = image_changed(tgid, birth, &image);
    if (changed || is_exec) {
      struct stat mount, root, after_mount, after_root;
      bool namespace = resolution_namespace(request->pid, &mount, &root);
      unsigned long long hwcap = 0, hwcap2 = 0;
      bool platform = image_platform(request->pid, &hwcap, &hwcap2);
      FILE *saved_output = output;
      output = image_reader;
      fprintf(output,
              "{\"changed\":%s,\"namespace\":%s,\"platform\":\"%llx:%llx\","
              "\"platformMatches\":%s,\"environment\":",
              changed ? "true" : "false", namespace ? "true" : "false", hwcap,
              hwcap2, platform ? "true" : "false");
      bytes_json(&environment);
      fprintf(output,
              " ,\"row\":{\"kind\":\"attempt\",\"id\":\"%llu\",\"tid\":%d,"
              "\"tgid\":%lu,\"ppid\":%lu,\"birth\":\"%llu\",\"parentBirth\":\"%"
              "llu\",\"syscall\":\"%s\",\"operation\":\"%s\",\"outcome\":"
              "\"unknown\",\"canceled\":%s,\"factsComplete\":true,\"args\":["
              "\"0\",\"0\",\"0\",\"0\",\"0\",\"0\"],\"cwd\":",
              (unsigned long long)request->id, request->pid, tgid, ppid, birth,
              parent_birth, call->name, call->operation,
              canceled ? "true" : "false");
      bytes_json(&cwd);
      fputs(",\"image\":", output);
      bytes_json(&image);
      fputs(",\"argvRead\":false,\"argv\":", output);
      bytes_json(&argv);
      if (is_exec) {
        fputs(",\"exec\":{\"source\":\"syscall-entry\",\"argv\":", output);
        bytes_json(&requested_argv);
        fputs(",\"target\":", output);
        bytes_json(&target);
        fputc('}', output);
      }
      fputs(",\"paths\":[],\"dirfds\":[]}}\n", output);
      output = saved_output;
      loader_fact = image_reader_reply();
      if (!loader_fact)
        record_error("image reader protocol", errno ? errno : EIO);
      namespace_stable =
          namespace &&
          resolution_namespace(request->pid, &after_mount, &after_root) &&
          same_identity(&mount, &after_mount) &&
          same_identity(&root, &after_root);
    }
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
  if (is_exec) {
    fputs(",\"exec\":{\"source\":\"syscall-entry\",\"argv\":", output);
    bytes_json(&requested_argv);
    fputs(",\"target\":", output);
    bytes_json(&target);
    fputs(",\"environment\":", output);
    bytes_json(&environment);
    fputc('}', output);
  }
  if (loader_fact && strcmp(loader_fact, "null"))
    fprintf(output, ",\"imageLoader\":{\"namespaceStable\":%s,\"capture\":%s}",
            namespace_stable ? "true" : "false", loader_fact);
  fputs(",\"paths\":[", output);
  for (unsigned i = 0; i < call->count; i++) {
    if (i)
      fputc(',', output);
    fprintf(output, "{\"arg\":%d,\"dirfdArg\":%d,\"value\":", call->paths[i],
            call->dirfds[i]);
    bytes_json(&paths[i]);
    const Bytes *anchor =
        call->dirfds[i] < 0 ||
                (int)request->data.args[call->dirfds[i]] == AT_FDCWD
            ? &cwd
            : &descriptors[i];
    resolve_attempt_path(request->pid, tgid, &paths[i], anchor,
                         &resolution_rows[i]);
    fputs(",\"resolution\":", output);
    resolution_json(&resolution_rows[i]);
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
  // An exit notification can be canceled when another thread terminates the
  // group. Its vanished identity contains no filesystem candidate. Keep the
  // raw terminal fact, but do not mistake it for a failed pathname read.
  bool canceled_lifetime = canceled && !call->count && call->dirfds[0] < 0 &&
                           !strcmp(call->operation, "lifetime");
  if (!complete && !canceled_lifetime)
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
    if (*end || fd < 0 || fd == dirfd(directory) || fd == observation_fd)
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
    unsigned char data[PATH_BYTES];
    Bytes target = read_link(path, data);
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
  flush_output();
  if (!reaped)
    kill(root, signal);
}
static void child_error(int fd, int stage) {
  ChildError value = {.stage = stage, .error = errno};
  (void)write(fd, &value, sizeof(value));
  _exit(127);
}
static int terminal_status(int signal, const sigset_t *original) {
  struct sigaction action_default = {0};
  action_default.sa_handler = SIG_DFL;
  sigemptyset(&action_default.sa_mask);
  sigaction(signal, &action_default, NULL);
  sigprocmask(SIG_SETMASK, original, NULL);
  raise(signal);
  return 128 + signal;
}

static void *task_anchor_probe(void *unused) {
  (void)unused;
  int fd = open("/proc/thread-self/comm", O_RDONLY);
  if (fd < 0)
    return (void *)1;
  char byte;
  bool failed = read(fd, &byte, 1) != 1;
  close(fd);
  return failed ? (void *)1 : NULL;
}
int main(int argc, char **argv) {
  // A control exercises this native kernel reader under the same observer;
  // test launchers do not acquire a second /proc reader or a path exception.
  if (argc == 2 && !strcmp(argv[1], "--self-image-probe")) {
    unsigned char data[PATH_BYTES];
    Bytes image = proc_link(getpid(), "exe", data);
    return good(&image) && !image.null ? 0 : 2;
  }
  if (argc == 2 && !strcmp(argv[1], "--task-anchor-probe")) {
    int fd = open("/proc/self/limits", O_RDONLY);
    char byte;
    if (fd < 0 || read(fd, &byte, 1) != 1)
      return 2;
    close(fd);
    pthread_t thread;
    void *result;
    if (pthread_create(&thread, NULL, task_anchor_probe, NULL) ||
        pthread_join(thread, &result) || result)
      return 2;
    unsigned char data[PATH_BYTES];
    Bytes image = proc_link(getpid(), "exe", data);
    return good(&image) && !image.null ? 0 : 2;
  }
  if (argc == 3 && !strcmp(argv[1], "--birth")) {
    char *end;
    unsigned long pid = strtoul(argv[2], &end, 10);
    unsigned long long birth = !*end && pid ? process_birth(pid) : 0;
    if (!birth) {
      fputs("file input observer: recorder process identity is unavailable\n",
            stderr);
      return 2;
    }
    printf("%llu\n", birth);
    return 0;
  }
  int command_index = 3;
  if (argc >= 6 && !strcmp(argv[2], "--image-reader") &&
      !strcmp(argv[4], "--")) {
    if (strlen(argv[3]) != 64 || strspn(argv[3], "0123456789abcdef") != 64 ||
        fcntl(3, F_SETFD, FD_CLOEXEC) || fcntl(4, F_SETFD, FD_CLOEXEC))
      return 2;
    image_reader_recipe = argv[3];
    image_reader = fdopen(3, "w");
    if (!image_reader)
      return 2;
    command_index = 5;
  }
  if (argc <= command_index || strcmp(argv[command_index - 1], "--")) {
    fputs("usage: file-input-observer <record> -- <command> [args...]\n",
          stderr);
    return 2;
  }
  if (asprintf(&pending_path, "%s.pending.%d", argv[1], getpid()) < 0)
    fatal("observation pending path");
  int logfd = open(pending_path, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
  if (logfd < 0)
    fatal("create observation");
  observation_fd = logfd;
  compressed = gzdopen(logfd, "wb1");
  if (!compressed || gzbuffer(compressed, 65536))
    fatal("compressed observation buffer");
  cookie_io_functions_t functions = {.write = compressed_write,
                                     .close = compressed_close};
  output = fopencookie(compressed, "w", functions);
  if (!output)
    fatal("observation stream");
  static char buffer[65536];
  if (setvbuf(output, buffer, _IOFBF, sizeof(buffer)))
    fatal("observation buffer");
  fputs("{\"kind\":\"start\",\"version\":6,\"mechanism\":\"seccomp-user-"
        "notification\",\"noNewPrivileges\":true,\"imageReaderRecipe\":",
        output);
  if (image_reader_recipe)
    fprintf(output, "\"%s\"", image_reader_recipe);
  else
    fputs("null", output);
  fputs("}\n", output);
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
    execvp(argv[command_index], argv + command_index);
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
    int status = 0;
    pid_t waited;
    do {
      waited = waitpid(root, &status, 0);
    } while (waited < 0 && errno == EINTR);
    if (waited != root)
      fatal("reap failed listener startup");
    fprintf(output,
            "{\"kind\":\"root-exit\",\"root\":%d,\"exit\":%d,\"signal\":%d}\n",
            root, WIFEXITED(status) ? WEXITSTATUS(status) : -1,
            WIFSIGNALED(status) ? WTERMSIG(status) : 0);
    fprintf(output,
            "{\"kind\":\"complete\",\"complete\":false,\"entered\":false,"
            "\"root\":%d,\"exit\":%d,\"signal\":%d,\"attempts\":0,\"errors\":1,"
            "\"drainComplete\":true,\"observerSignal\":%d,\"stage\":%d,"
            "\"execErrno\":%d}\n",
            root, WIFEXITED(status) ? WEXITSTATUS(status) : -1,
            WIFSIGNALED(status) ? WTERMSIG(status) : 0, terminal_signal,
            launch_error.stage, launch_error.error);
    bool published = publish_observation(argv[1]);
    if (terminal_signal)
      return terminal_status(terminal_signal, &original);
    if (!published)
      return 2;
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
      if (child == root && !reaped) {
        root_status = status;
        reaped = true;
        ended = now_ns();
        fprintf(
            output,
            "{\"kind\":\"root-exit\",\"root\":%d,\"exit\":%d,\"signal\":%d}\n",
            root, WIFEXITED(root_status) ? WEXITSTATUS(root_status) : -1,
            WIFSIGNALED(root_status) ? WTERMSIG(root_status) : 0);
        flush_output();
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
  if (image_reader) {
    fputs("{\"kind\":\"close\"}\n", image_reader);
    const char *end = image_reader_reply();
    if (!end)
      record_error("image reader drain", errno ? errno : EIO);
    else
      fprintf(output, "{\"kind\":\"image-reader-end\",\"value\":%s}\n", end);
    fclose(image_reader);
    image_reader = NULL;
    close(4);
  }
  for (unsigned i = 0; i < 4096; i++)
    while (task_images[i]) {
      TaskImage *next = task_images[i]->next;
      free(task_images[i]);
      task_images[i] = next;
    }
  check_output();
  bool complete = drained && !errors && !output_failed;
  fprintf(output,
          "{\"kind\":\"complete\",\"complete\":%s,\"root\":%d,\"entered\":%s,"
          "\"execErrno\":%d,\"exit\":%d,\"signal\":%d,\"resolutionWalks\":%lu,"
          "\"resolutionStats\":%lu,\"attempts\":%lu,"
          "\"errors\":%lu,\"drainComplete\":%s,\"observerSignal\":%d}\n",
          complete ? "true" : "false", root, entered ? "true" : "false",
          launch_error.error,
          WIFEXITED(root_status) ? WEXITSTATUS(root_status) : -1,
          WIFSIGNALED(root_status) ? WTERMSIG(root_status) : 0,
          resolution_walks, resolution_stats, attempts, errors,
          drained ? "true" : "false", terminal_signal);
  if (!publish_observation(argv[1]))
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
    return terminal_status(signal, &original);
  }
  return WEXITSTATUS(root_status);
}
