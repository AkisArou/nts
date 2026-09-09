/* The native half of `node:fs`, sync surface.
 *
 * Operations use `uv_fs_*` with a NULL callback, which is how node's own
 * `SyncCall` runs them, plus the conversion between `NtsString` and the UTF-8
 * libuv takes. Whole-file operations repeat the primitive read or write until
 * completion, just as `lib/fs.js` does. Node's `src/node_file.cc` has the same
 * boundary with `v8::Local` where these have `NtsString`.
 *
 * Errors are reported as libuv's negative errno through `nts_errno`, and the
 * TypeScript builds the exception. Keeping the message construction upstairs
 * means there is one copy of it and it is the one node's tests read. */
#include "fs.h"
#include "../internal/shared.h"
#include <fcntl.h>
#include <inttypes.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <uv.h>

/* A call whose only result is success or failure. */
static double simple(int result) {
  nts_node_set_errno(result);
  return (double)result;
}

static char *native_path(const NtsString *path) {
  char *value = nts_node_to_utf8_alloc(path, NULL);
  if (value == NULL) nts_node_set_errno(UV_ENOMEM);
  return value;
}

/* A Buffer path is already the byte sequence libuv expects. Decoding it as
 * UTF-8 first would change legal POSIX filenames containing arbitrary bytes. */
static char *native_byte_path(const NtsArray *path) {
  size_t length = (size_t)path->header.length;
  char *value = malloc(length + 1);
  if (value == NULL) {
    nts_node_set_errno(UV_ENOMEM);
    return NULL;
  }
  const double *bytes = NTS_ITEMS(path, double);
  for (size_t i = 0; i < length; i++) {
    double byte = bytes[i];
    if (byte != byte || byte <= 0.0 || byte > 255.0 ||
        byte != (double)(unsigned char)byte) {
      free(value);
      nts_node_set_errno(UV_EINVAL);
      return NULL;
    }
    value[i] = (char)(unsigned char)byte;
  }
  value[length] = '\0';
  return value;
}

static NtsArray *native_bytes(const char *value, size_t length) {
  NtsArray *bytes = nts_array_new(&nts_node_desc_double, (double)length);
  double *items = NTS_ITEMS(bytes, double);
  for (size_t i = 0; i < length; i++) {
    items[i] = (double)(unsigned char)value[i];
  }
  return bytes;
}

static NtsArray *empty_doubles(void) {
  return nts_array_new(&nts_node_desc_double, 0);
}

static NtsString *empty_string(void) {
  return nts_string_from_utf8("", 0);
}

double nts_fs_o_creat(void) { return (double)O_CREAT; }
double nts_fs_o_excl(void) { return (double)O_EXCL; }
double nts_fs_o_trunc(void) { return (double)O_TRUNC; }
double nts_fs_o_append(void) { return (double)O_APPEND; }
double nts_fs_o_sync(void) { return (double)O_SYNC; }
#ifdef O_DIRECT
double nts_fs_o_direct(void) { return (double)O_DIRECT; }
#else
double nts_fs_o_direct(void) { return 0; }
#endif
#ifdef O_DIRECTORY
double nts_fs_o_directory(void) { return (double)O_DIRECTORY; }
#else
double nts_fs_o_directory(void) { return 0; }
#endif
#ifdef O_DSYNC
double nts_fs_o_dsync(void) { return (double)O_DSYNC; }
#else
double nts_fs_o_dsync(void) { return 0; }
#endif
#ifdef O_NOATIME
double nts_fs_o_noatime(void) { return (double)O_NOATIME; }
#else
double nts_fs_o_noatime(void) { return 0; }
#endif
#ifdef O_NOCTTY
double nts_fs_o_noctty(void) { return (double)O_NOCTTY; }
#else
double nts_fs_o_noctty(void) { return 0; }
#endif
#ifdef O_NOFOLLOW
double nts_fs_o_nofollow(void) { return (double)O_NOFOLLOW; }
#else
double nts_fs_o_nofollow(void) { return 0; }
#endif
#ifdef O_NONBLOCK
double nts_fs_o_nonblock(void) { return (double)O_NONBLOCK; }
#else
double nts_fs_o_nonblock(void) { return 0; }
#endif
double nts_fs_o_filemap(void) { return (double)UV_FS_O_FILEMAP; }
bool nts_fs_binding_warns_on_mkdtemp(void) { return false; }
bool nts_fs_is_32_bit(void) { return sizeof(void *) == 4; }
double nts_fs_eisdir(void) { return (double)UV_EISDIR; }

/* ------------------------------------------------------------------ stat */

/* `uv_stat_t` as fourteen doubles, in the order `Stats` reads them. One
 * binding answers `stat`, `lstat` and `fstat`: the difference is which libuv
 * call fills the buffer, not what comes back. */
static NtsArray *stat_columns(const uv_stat_t *st) {
  NtsArray *a = nts_array_new(&nts_node_desc_double, 14);
  double *v = NTS_ITEMS(a, double);
  v[0] = (double)st->st_dev;
  v[1] = (double)st->st_mode;
  v[2] = (double)st->st_nlink;
  v[3] = (double)st->st_uid;
  v[4] = (double)st->st_gid;
  v[5] = (double)st->st_rdev;
  v[6] = (double)st->st_blksize;
  v[7] = (double)st->st_ino;
  v[8] = (double)st->st_size;
  v[9] = (double)st->st_blocks;
  /* Milliseconds, which is what `Stats.atimeMs` is. */
  v[10] =
      (double)st->st_atim.tv_sec * 1000.0 + (double)st->st_atim.tv_nsec / 1.0e6;
  v[11] =
      (double)st->st_mtim.tv_sec * 1000.0 + (double)st->st_mtim.tv_nsec / 1.0e6;
  v[12] =
      (double)st->st_ctim.tv_sec * 1000.0 + (double)st->st_ctim.tv_nsec / 1.0e6;
  v[13] = (double)st->st_birthtim.tv_sec * 1000.0 +
          (double)st->st_birthtim.tv_nsec / 1.0e6;
  return a;
}

static NtsString *signed_int128_string(__int128 value) {
  char storage[64];
  char *end = storage + sizeof(storage);
  char *cursor = end;
  bool negative = value < 0;
  unsigned __int128 magnitude = negative
                                    ? (unsigned __int128)(-(value + 1)) + 1
                                    : (unsigned __int128)value;
  do {
    *--cursor = (char)('0' + magnitude % 10);
    magnitude /= 10;
  } while (magnitude != 0);
  if (negative) *--cursor = '-';
  return nts_string_from_utf8(cursor, (size_t)(end - cursor));
}

static NtsArray *stat_bigint_columns(const uv_stat_t *stats) {
  NtsArray *columns = nts_array_new(&nts_desc_ref, 14);
  void **values = NTS_ITEMS(columns, void *);
  values[0] = signed_int128_string((__int128)(uint64_t)stats->st_dev);
  values[1] = signed_int128_string((__int128)(uint64_t)stats->st_mode);
  values[2] = signed_int128_string((__int128)(uint64_t)stats->st_nlink);
  values[3] = signed_int128_string((__int128)(uint64_t)stats->st_uid);
  values[4] = signed_int128_string((__int128)(uint64_t)stats->st_gid);
  values[5] = signed_int128_string((__int128)(uint64_t)stats->st_rdev);
  values[6] = signed_int128_string((__int128)(uint64_t)stats->st_blksize);
  values[7] = signed_int128_string((__int128)(uint64_t)stats->st_ino);
  values[8] = signed_int128_string((__int128)(uint64_t)stats->st_size);
  values[9] = signed_int128_string((__int128)(uint64_t)stats->st_blocks);
  values[10] = signed_int128_string(
      (__int128)stats->st_atim.tv_sec * 1000000000 + stats->st_atim.tv_nsec);
  values[11] = signed_int128_string(
      (__int128)stats->st_mtim.tv_sec * 1000000000 + stats->st_mtim.tv_nsec);
  values[12] = signed_int128_string(
      (__int128)stats->st_ctim.tv_sec * 1000000000 + stats->st_ctim.tv_nsec);
  values[13] = signed_int128_string((__int128)stats->st_birthtim.tv_sec *
                                        1000000000 +
                                    stats->st_birthtim.tv_nsec);
  return columns;
}

static NtsArray *stat_native_path(const char *path, bool follow) {
  uv_fs_t request;
  int result = follow ? uv_fs_stat(NULL, &request, path, NULL)
                      : uv_fs_lstat(NULL, &request, path, NULL);
  nts_node_set_errno(result);
  NtsArray *columns =
      result == 0 ? stat_columns(&request.statbuf) : empty_doubles();
  uv_fs_req_cleanup(&request);
  return columns;
}

static NtsArray *stat_bigint_native_path(const char *path, bool follow) {
  uv_fs_t request;
  int result = follow ? uv_fs_stat(NULL, &request, path, NULL)
                      : uv_fs_lstat(NULL, &request, path, NULL);
  nts_node_set_errno(result);
  NtsArray *columns = result == 0
                          ? stat_bigint_columns(&request.statbuf)
                          : nts_array_new(&nts_desc_ref, 0);
  uv_fs_req_cleanup(&request);
  return columns;
}

NtsArray *nts_fs_stat(NtsString *path, bool follow) {
  char *native = native_path(path);
  if (native == NULL) return empty_doubles();
  NtsArray *columns = stat_native_path(native, follow);
  free(native);
  return columns;
}

NtsArray *nts_fs_stat_bytes(NtsArray *path, bool follow) {
  char *native = native_byte_path(path);
  if (native == NULL) return empty_doubles();
  NtsArray *columns = stat_native_path(native, follow);
  free(native);
  return columns;
}

NtsArray *nts_fs_stat_bigint(NtsString *path, bool follow) {
  char *native = native_path(path);
  if (native == NULL) return nts_array_new(&nts_desc_ref, 0);
  NtsArray *columns = stat_bigint_native_path(native, follow);
  free(native);
  return columns;
}

NtsArray *nts_fs_stat_bigint_bytes(NtsArray *path, bool follow) {
  char *native = native_byte_path(path);
  if (native == NULL) return nts_array_new(&nts_desc_ref, 0);
  NtsArray *columns = stat_bigint_native_path(native, follow);
  free(native);
  return columns;
}

NtsArray *nts_fs_fstat(double fd) {
  uv_fs_t req;
  int r = uv_fs_fstat(NULL, &req, (uv_file)fd, NULL);
  nts_node_set_errno(r);
  NtsArray *out = r == 0 ? stat_columns(&req.statbuf) : empty_doubles();
  uv_fs_req_cleanup(&req);
  return out;
}

NtsArray *nts_fs_fstat_bigint(double fd) {
  uv_fs_t request;
  int result = uv_fs_fstat(NULL, &request, (uv_file)fd, NULL);
  nts_node_set_errno(result);
  NtsArray *columns = result == 0
                          ? stat_bigint_columns(&request.statbuf)
                          : nts_array_new(&nts_desc_ref, 0);
  uv_fs_req_cleanup(&request);
  return columns;
}

static void statfs_columns(const uv_statfs_t *stats, uint64_t columns[8]) {
  columns[0] = stats->f_type;
  columns[1] = stats->f_bsize;
  columns[2] = stats->f_frsize;
  columns[3] = stats->f_blocks;
  columns[4] = stats->f_bfree;
  columns[5] = stats->f_bavail;
  columns[6] = stats->f_files;
  columns[7] = stats->f_ffree;
}

static NtsArray *statfs_number_native_path(const char *path) {
  uv_fs_t request;
  int result = uv_fs_statfs(NULL, &request, path, NULL);
  nts_node_set_errno(result);
  if (result < 0) {
    uv_fs_req_cleanup(&request);
    return empty_doubles();
  }
  uint64_t columns[8];
  statfs_columns(request.ptr, columns);
  NtsArray *values = nts_array_new(&nts_node_desc_double, 8);
  for (size_t index = 0; index < 8; index++) {
    NTS_ITEMS(values, double)[index] = (double)columns[index];
  }
  uv_fs_req_cleanup(&request);
  return values;
}

static NtsArray *statfs_bigint_native_path(const char *path) {
  uv_fs_t request;
  int result = uv_fs_statfs(NULL, &request, path, NULL);
  nts_node_set_errno(result);
  if (result < 0) {
    uv_fs_req_cleanup(&request);
    return nts_array_new(&nts_desc_ref, 0);
  }
  uint64_t columns[8];
  statfs_columns(request.ptr, columns);
  NtsArray *values = nts_array_new(&nts_desc_ref, 8);
  for (size_t index = 0; index < 8; index++) {
    char decimal[32];
    int length = snprintf(decimal, sizeof(decimal), "%" PRIu64, columns[index]);
    NTS_ITEMS(values, void *)[index] =
        nts_string_from_utf8(decimal, (size_t)length);
  }
  uv_fs_req_cleanup(&request);
  return values;
}

NtsArray *nts_fs_statfs(NtsString *path) {
  char *native = native_path(path);
  if (native == NULL) return empty_doubles();
  NtsArray *columns = statfs_number_native_path(native);
  free(native);
  return columns;
}

NtsArray *nts_fs_statfs_bytes(NtsArray *path) {
  char *native = native_byte_path(path);
  if (native == NULL) return empty_doubles();
  NtsArray *columns = statfs_number_native_path(native);
  free(native);
  return columns;
}

NtsArray *nts_fs_statfs_bigint(NtsString *path) {
  char *native = native_path(path);
  if (native == NULL) return nts_array_new(&nts_desc_ref, 0);
  NtsArray *columns = statfs_bigint_native_path(native);
  free(native);
  return columns;
}

NtsArray *nts_fs_statfs_bigint_bytes(NtsArray *path) {
  char *native = native_byte_path(path);
  if (native == NULL) return nts_array_new(&nts_desc_ref, 0);
  NtsArray *columns = statfs_bigint_native_path(native);
  free(native);
  return columns;
}

/* ---------------------------------------------------------- open and read */

static double open_native_path(const char *path, double flags, double mode) {
  uv_fs_t req;
  int fd = uv_fs_open(NULL, &req, path, (int)flags, (int)mode, NULL);
  uv_fs_req_cleanup(&req);
  nts_node_set_errno(fd);
  return (double)fd;
}

double nts_fs_open(NtsString *path, double flags, double mode) {
  char *native = native_path(path);
  if (native == NULL) return (double)UV_ENOMEM;
  double descriptor = open_native_path(native, flags, mode);
  free(native);
  return descriptor;
}

double nts_fs_open_bytes(NtsArray *path, double flags, double mode) {
  char *native = native_byte_path(path);
  if (native == NULL) return (double)-nts_errno();
  double descriptor = open_native_path(native, flags, mode);
  free(native);
  return descriptor;
}

double nts_fs_close(double fd) {
  uv_fs_t req;
  int r = uv_fs_close(NULL, &req, (uv_file)fd, NULL);
  uv_fs_req_cleanup(&req);
  return simple(r);
}

/* One descriptor read returns exactly the bytes libuv supplied. A short read
 * is a successful result, not an EOF marker, so this deliberately makes only
 * one syscall rather than filling the requested length in a loop. */
static NtsArray *read_from_descriptor(double fd, double length,
                                      int64_t position) {
  size_t size = (size_t)length;
  if (size == 0) {
    nts_node_set_errno(0);
    return empty_doubles();
  }
  char *data = malloc(size);
  if (data == NULL) {
    nts_node_set_errno(UV_ENOMEM);
    return nts_array_new(&nts_node_desc_double, 0);
  }

  uv_buf_t buffer = uv_buf_init(data, (unsigned int)size);
  uv_fs_t request;
  int result = uv_fs_read(NULL, &request, (uv_file)fd, &buffer, 1, position,
                          NULL);
  uv_fs_req_cleanup(&request);
  nts_node_set_errno(result);

  size_t count = result < 0 ? 0 : (size_t)result;
  NtsArray *bytes = nts_array_new(&nts_node_desc_double, (double)count);
  for (size_t i = 0; i < count; i++) {
    NTS_ITEMS(bytes, double)[i] = (double)(unsigned char)data[i];
  }
  free(data);
  return bytes;
}

NtsArray *nts_fs_read(double fd, double length, double position) {
  return read_from_descriptor(fd, length, (int64_t)position);
}

NtsArray *nts_fs_read_bigint(double fd, double length, __int128 position) {
  return read_from_descriptor(fd, length, (int64_t)position);
}

static bool vector_layout(NtsArray *lengths, size_t *total) {
  size_t count = (size_t)lengths->header.length;
  if (count > UINT_MAX) return false;
  size_t sum = 0;
  for (size_t index = 0; index < count; index++) {
    double raw = NTS_ITEMS(lengths, double)[index];
    if (raw < 0 || raw > UINT_MAX) return false;
    size_t length = (size_t)raw;
    if ((double)length != raw || length > SIZE_MAX - sum) return false;
    sum += length;
  }
  *total = sum;
  return true;
}

static uv_buf_t *make_vector_buffers(NtsArray *lengths, char *data) {
  size_t count = (size_t)lengths->header.length;
  uv_buf_t *buffers = calloc(count > 0 ? count : 1, sizeof(*buffers));
  if (buffers == NULL) return NULL;
  size_t offset = 0;
  for (size_t index = 0; index < count; index++) {
    unsigned int length = (unsigned int)NTS_ITEMS(lengths, double)[index];
    buffers[index] = uv_buf_init(data + offset, length);
    offset += length;
  }
  return buffers;
}

NtsArray *nts_fs_readv(double fd, NtsArray *lengths, double position) {
  size_t count = (size_t)lengths->header.length;
  size_t total = 0;
  if (!vector_layout(lengths, &total)) {
    nts_node_set_errno(UV_EINVAL);
    return empty_doubles();
  }
  if (count == 0 || total == 0) {
    nts_node_set_errno(0);
    return empty_doubles();
  }

  char *data = malloc(total);
  uv_buf_t *buffers = data == NULL ? NULL : make_vector_buffers(lengths, data);
  if (buffers == NULL) {
    free(data);
    nts_node_set_errno(UV_ENOMEM);
    return empty_doubles();
  }

  uv_fs_t request;
  int result = uv_fs_read(NULL, &request, (uv_file)fd, buffers,
                          (unsigned int)count, (int64_t)position, NULL);
  uv_fs_req_cleanup(&request);
  nts_node_set_errno(result);

  size_t bytes_read = result < 0 ? 0 : (size_t)result;
  NtsArray *bytes =
      nts_array_new(&nts_node_desc_double, (double)bytes_read);
  for (size_t index = 0; index < bytes_read; index++) {
    NTS_ITEMS(bytes, double)[index] = (double)(unsigned char)data[index];
  }
  free(buffers);
  free(data);
  return bytes;
}

/* One descriptor write likewise returns the kernel's count. Looping here
 * would erase the short-write behavior the public API is specified to expose. */
double nts_fs_write(double fd, NtsArray *bytes, double position) {
  size_t size = (size_t)bytes->header.length;
  char *data = malloc(size > 0 ? size : 1);
  if (data == NULL) return simple(UV_ENOMEM);
  for (size_t i = 0; i < size; i++) {
    data[i] = (char)(unsigned char)NTS_ITEMS(bytes, double)[i];
  }

  uv_buf_t buffer = uv_buf_init(data, (unsigned int)size);
  uv_fs_t request;
  int result = uv_fs_write(NULL, &request, (uv_file)fd, &buffer, 1,
                           (int64_t)position, NULL);
  uv_fs_req_cleanup(&request);
  free(data);
  return simple(result);
}

double nts_fs_writev(double fd, NtsArray *bytes, NtsArray *lengths,
                     double position) {
  size_t count = (size_t)lengths->header.length;
  size_t total = 0;
  if (!vector_layout(lengths, &total) ||
      total != (size_t)bytes->header.length) {
    return simple(UV_EINVAL);
  }
  if (count == 0 || total == 0) return simple(0);

  char *data = malloc(total);
  if (data == NULL) return simple(UV_ENOMEM);
  for (size_t index = 0; index < total; index++) {
    data[index] = (char)(unsigned char)NTS_ITEMS(bytes, double)[index];
  }
  uv_buf_t *buffers = make_vector_buffers(lengths, data);
  if (buffers == NULL) {
    free(data);
    return simple(UV_ENOMEM);
  }

  uv_fs_t request;
  int result = uv_fs_write(NULL, &request, (uv_file)fd, buffers,
                           (unsigned int)count, (int64_t)position, NULL);
  uv_fs_req_cleanup(&request);
  free(buffers);
  free(data);
  return simple(result);
}

double nts_fs_fsync(double fd) {
  uv_fs_t request;
  int result = uv_fs_fsync(NULL, &request, (uv_file)fd, NULL);
  uv_fs_req_cleanup(&request);
  return simple(result);
}

double nts_fs_fdatasync(double fd) {
  uv_fs_t request;
  int result = uv_fs_fdatasync(NULL, &request, (uv_file)fd, NULL);
  uv_fs_req_cleanup(&request);
  return simple(result);
}

double nts_fs_ftruncate(double fd, double length) {
  uv_fs_t request;
  int result = uv_fs_ftruncate(NULL, &request, (uv_file)fd,
                               (int64_t)length, NULL);
  uv_fs_req_cleanup(&request);
  return simple(result);
}

double nts_fs_fchmod(double fd, double mode) {
  uv_fs_t request;
  int result = uv_fs_fchmod(NULL, &request, (uv_file)fd, (int)mode, NULL);
  uv_fs_req_cleanup(&request);
  return simple(result);
}

double nts_fs_fchown(double fd, double uid, double gid) {
  uv_fs_t request;
  int result = uv_fs_fchown(NULL, &request, (uv_file)fd, (uv_uid_t)uid,
                            (uv_gid_t)gid, NULL);
  uv_fs_req_cleanup(&request);
  return simple(result);
}

double nts_fs_futimes(double fd, double atime, double mtime) {
  uv_fs_t request;
  int result =
      uv_fs_futime(NULL, &request, (uv_file)fd, atime, mtime, NULL);
  uv_fs_req_cleanup(&request);
  return simple(result);
}

static double lutimes_native_path(char *p, double atime, double mtime) {
  uv_fs_t request;
  int result = uv_fs_lutime(NULL, &request, p, atime, mtime, NULL);
  uv_fs_req_cleanup(&request);
  return simple(result);
}

double nts_fs_lutimes(NtsString *path, double atime, double mtime) {
  char *p = native_path(path);
  if (p == NULL) return (double)UV_ENOMEM;
  double r = lutimes_native_path(p, atime, mtime);
  free(p);
  return r;
}

/* The same call against a path that is already bytes. Node accepts a Buffer
 * wherever it accepts a string path, and a filename need not be valid UTF-8 --
 * decoding one to route it through the string form would rename the file. */
double nts_fs_lutimes_bytes(NtsArray *path, double atime, double mtime) {
  char *p = native_byte_path(path);
  if (p == NULL) return (double)-nts_errno();
  double r = lutimes_native_path(p, atime, mtime);
  free(p);
  return r;
}

/* With growth disabled, the capacity is the fstat size of a regular-file byte
 * read and therefore also the limit Node observes if the file grows
 * concurrently. Streaming and UTF-8 reads use an initial chunk and grow. */
static char *read_entire_descriptor(uv_file descriptor,
                                    size_t initial_capacity, bool allow_growth,
                                    size_t *length, int *error_out) {
  uv_fs_t request;
  size_t capacity = initial_capacity > 0 ? initial_capacity : 8192;
  size_t used = 0;
  char *data = malloc(capacity);
  int error = data == NULL ? UV_ENOMEM : 0;

  while (error == 0) {
    if (used == capacity) {
      if (!allow_growth) break;
      if (capacity > SIZE_MAX / 2) {
        error = UV_ENOMEM;
        break;
      }
      size_t next_capacity = capacity * 2;
      char *grown = realloc(data, next_capacity);
      if (grown == NULL) {
        error = UV_ENOMEM;
        break;
      }
      data = grown;
      capacity = next_capacity;
    }

    size_t remaining = capacity - used;
    unsigned int chunk = remaining > UINT_MAX
                             ? UINT_MAX
                             : (unsigned int)remaining;
    uv_buf_t buffer = uv_buf_init(data + used, chunk);
    int result = uv_fs_read(NULL, &request, descriptor, &buffer, 1, -1, NULL);
    uv_fs_req_cleanup(&request);
    if (result < 0) {
      error = result;
      break;
    }
    if (result == 0) break;
    used += (size_t)result;
  }

  if (error < 0) {
    free(data);
    *error_out = error;
    return NULL;
  }

  *error_out = 0;
  *length = used;
  return data;
}

static int write_entire_descriptor(uv_file descriptor, const char *data,
                                   size_t length) {
  uv_fs_t request;
  size_t written = 0;
  int error = 0;
  while (written < length) {
    size_t remaining = length - written;
    unsigned int chunk = remaining > UINT_MAX
                             ? UINT_MAX
                             : (unsigned int)remaining;
    uv_buf_t buffer = uv_buf_init((char *)data + written, chunk);
    int result = uv_fs_write(NULL, &request, descriptor, &buffer, 1, -1,
                             NULL);
    uv_fs_req_cleanup(&request);
    if (result < 0) {
      error = result;
      break;
    }
    if (result == 0) {
      error = UV_EIO;
      break;
    }
    written += (size_t)result;
  }

  return error;
}

double nts_fs_write_file_utf8_fd(double fd, NtsString *contents) {
  size_t length = 0;
  char *data = nts_node_to_utf8_alloc(contents, &length);
  if (data == NULL) return simple(UV_ENOMEM);
  int error = write_entire_descriptor((uv_file)fd, data, length);
  free(data);
  return simple(error);
}

/* ---------------------------------------------------------------- entries */

typedef struct NtsFsDirectory {
  uint64_t identifier;
  uv_dir_t *directory;
  struct NtsFsDirectory *next;
} NtsFsDirectory;

/* An addon may be loaded in more than one Worker. Directory ownership and
 * lookup therefore follow the calling runtime thread, as the handles do. */
static _Thread_local NtsFsDirectory *nts_fs_directories;
static _Thread_local uint64_t nts_fs_next_directory_identifier = 1;

static NtsFsDirectory *find_directory(double identifier) {
  if (identifier < 1.0 || identifier > 9007199254740991.0 ||
      identifier != (double)(uint64_t)identifier) {
    return NULL;
  }
  uint64_t wanted = (uint64_t)identifier;
  for (NtsFsDirectory *entry = nts_fs_directories; entry != NULL;
       entry = entry->next) {
    if (entry->identifier == wanted) return entry;
  }
  return NULL;
}

static double register_directory(NtsFsDirectory *entry) {
  do {
    if (nts_fs_next_directory_identifier > 9007199254740991ULL) {
      nts_fs_next_directory_identifier = 1;
    }
    entry->identifier = nts_fs_next_directory_identifier++;
  } while (find_directory((double)entry->identifier) != NULL);
  entry->next = nts_fs_directories;
  nts_fs_directories = entry;
  return (double)entry->identifier;
}

static void unlink_directory(NtsFsDirectory *entry) {
  NtsFsDirectory **link = &nts_fs_directories;
  while (*link != NULL) {
    if (*link == entry) {
      *link = entry->next;
      entry->next = NULL;
      return;
    }
    link = &(*link)->next;
  }
}

static NtsArray *dirent_rows(const uv_dirent_t *entries, size_t count) {
  NtsArray *rows = nts_array_new(&nts_desc_ref, (double)count);
  void **row_values = NTS_ITEMS(rows, void *);
  for (size_t index = 0; index < count; index++) {
    const uv_dirent_t *entry = &entries[index];
    size_t name_length = strlen(entry->name);
    NtsArray *row =
        nts_array_new(&nts_node_desc_double, (double)(name_length + 1));
    double *values = NTS_ITEMS(row, double);
    values[0] = (double)entry->type;
    for (size_t byte_index = 0; byte_index < name_length; byte_index++) {
      values[byte_index + 1] =
          (double)(unsigned char)entry->name[byte_index];
    }
    row_values[index] = row;
  }
  return rows;
}

/* Each row begins with `uv_dirent_type_t` and contains the name's exact bytes.
 * Returning both from one scan prevents a directory mutation from pairing a
 * name from one snapshot with a type from another. */
static NtsArray *scandir_native_path(const char *path) {
  uv_fs_t req;
  int count = uv_fs_scandir(NULL, &req, path, 0, NULL);
  nts_node_set_errno(count);
  if (count < 0) {
    uv_fs_req_cleanup(&req);
    return nts_array_new(&nts_desc_ref, 0);
  }

  uv_dirent_t *entries = calloc((size_t)count, sizeof(*entries));
  if (count != 0 && entries == NULL) {
    nts_node_set_errno(UV_ENOMEM);
    uv_fs_req_cleanup(&req);
    return nts_array_new(&nts_desc_ref, 0);
  }
  for (int index = 0; index < count; index++) {
    int next = uv_fs_scandir_next(&req, &entries[index]);
    if (next < 0) {
      nts_node_set_errno(next == UV_EOF ? UV_EIO : next);
      free(entries);
      uv_fs_req_cleanup(&req);
      return nts_array_new(&nts_desc_ref, 0);
    }
  }
  NtsArray *rows = dirent_rows(entries, (size_t)count);
  free(entries);
  uv_fs_req_cleanup(&req);
  nts_node_set_errno(0);
  return rows;
}

NtsArray *nts_fs_scandir(NtsString *path) {
  char *native = native_path(path);
  if (native == NULL) return nts_array_new(&nts_desc_ref, 0);
  NtsArray *rows = scandir_native_path(native);
  free(native);
  return rows;
}

NtsArray *nts_fs_scandir_bytes(NtsArray *path) {
  char *native = native_byte_path(path);
  if (native == NULL) return nts_array_new(&nts_desc_ref, 0);
  NtsArray *rows = scandir_native_path(native);
  free(native);
  return rows;
}

static double opendir_native_path(const char *path) {
  uv_fs_t request;
  int result = uv_fs_opendir(NULL, &request, path, NULL);
  nts_node_set_errno(result);
  if (result < 0) {
    uv_fs_req_cleanup(&request);
    return 0;
  }
  uv_dir_t *directory = request.ptr;
  uv_fs_req_cleanup(&request);

  NtsFsDirectory *entry = calloc(1, sizeof(*entry));
  if (entry == NULL) {
    uv_fs_t close_request;
    uv_fs_closedir(NULL, &close_request, directory, NULL);
    uv_fs_req_cleanup(&close_request);
    nts_node_set_errno(UV_ENOMEM);
    return 0;
  }
  entry->directory = directory;
  nts_node_set_errno(0);
  return register_directory(entry);
}

double nts_fs_opendir(NtsString *path) {
  char *native = native_path(path);
  if (native == NULL) return 0;
  double identifier = opendir_native_path(native);
  free(native);
  return identifier;
}

double nts_fs_opendir_bytes(NtsArray *path) {
  char *native = native_byte_path(path);
  if (native == NULL) return 0;
  double identifier = opendir_native_path(native);
  free(native);
  return identifier;
}

NtsArray *nts_fs_dir_read(double identifier, double buffer_size) {
  NtsFsDirectory *entry = find_directory(identifier);
  if (entry == NULL) {
    nts_node_set_errno(UV_EBADF);
    return nts_array_new(&nts_desc_ref, 0);
  }
  if (buffer_size < 1.0 || buffer_size > UINT32_MAX ||
      buffer_size != (double)(uint32_t)buffer_size) {
    nts_node_set_errno(UV_EINVAL);
    return nts_array_new(&nts_desc_ref, 0);
  }

  size_t capacity = (size_t)buffer_size;
  uv_dirent_t *entries = calloc(capacity, sizeof(*entries));
  if (entries == NULL) {
    nts_node_set_errno(UV_ENOMEM);
    return nts_array_new(&nts_desc_ref, 0);
  }
  entry->directory->dirents = entries;
  entry->directory->nentries = capacity;

  uv_fs_t request;
  int count = uv_fs_readdir(NULL, &request, entry->directory, NULL);
  entry->directory->dirents = NULL;
  entry->directory->nentries = 0;
  if (count < 0) {
    nts_node_set_errno(count);
    uv_fs_req_cleanup(&request);
    free(entries);
    return nts_array_new(&nts_desc_ref, 0);
  }
  NtsArray *rows = dirent_rows(entries, (size_t)count);
  uv_fs_req_cleanup(&request);
  free(entries);
  nts_node_set_errno(0);
  return rows;
}

double nts_fs_dir_close(double identifier) {
  NtsFsDirectory *entry = find_directory(identifier);
  if (entry == NULL) return simple(UV_EBADF);

  uv_fs_t request;
  int result = uv_fs_closedir(NULL, &request, entry->directory, NULL);
  uv_fs_req_cleanup(&request);
  if (result >= 0) {
    unlink_directory(entry);
    free(entry);
  }
  return simple(result);
}

/* ------------------------------------------------------------ one-liners */

static double unlink_native_path(char *p) {
  uv_fs_t req;
  double r = simple(uv_fs_unlink(NULL, &req, p, NULL));
  uv_fs_req_cleanup(&req);
  return r;
}

double nts_fs_unlink(NtsString *path) {
  char *p = native_path(path);
  if (p == NULL) return (double)UV_ENOMEM;
  double r = unlink_native_path(p);
  free(p);
  return r;
}

/* The same call against a path that is already bytes. Node accepts a Buffer
 * wherever it accepts a string path, and a filename need not be valid UTF-8 --
 * decoding one to route it through the string form would rename the file. */
double nts_fs_unlink_bytes(NtsArray *path) {
  char *p = native_byte_path(path);
  if (p == NULL) return (double)-nts_errno();
  double r = unlink_native_path(p);
  free(p);
  return r;
}

static double mkdir_native_path(char *p, double mode) {
  uv_fs_t req;
  double r = simple(uv_fs_mkdir(NULL, &req, p, (int)mode, NULL));
  uv_fs_req_cleanup(&req);
  return r;
}

double nts_fs_mkdir(NtsString *path, double mode) {
  char *p = native_path(path);
  if (p == NULL) return (double)UV_ENOMEM;
  double r = mkdir_native_path(p, mode);
  free(p);
  return r;
}

/* The same call against a path that is already bytes. Node accepts a Buffer
 * wherever it accepts a string path, and a filename need not be valid UTF-8 --
 * decoding one to route it through the string form would rename the file. */
double nts_fs_mkdir_bytes(NtsArray *path, double mode) {
  char *p = native_byte_path(path);
  if (p == NULL) return (double)-nts_errno();
  double r = mkdir_native_path(p, mode);
  free(p);
  return r;
}

static double rmdir_native_path(char *p) {
  uv_fs_t req;
  double r = simple(uv_fs_rmdir(NULL, &req, p, NULL));
  uv_fs_req_cleanup(&req);
  return r;
}

double nts_fs_rmdir(NtsString *path) {
  char *p = native_path(path);
  if (p == NULL) return (double)UV_ENOMEM;
  double r = rmdir_native_path(p);
  free(p);
  return r;
}

/* The same call against a path that is already bytes. Node accepts a Buffer
 * wherever it accepts a string path, and a filename need not be valid UTF-8 --
 * decoding one to route it through the string form would rename the file. */
double nts_fs_rmdir_bytes(NtsArray *path) {
  char *p = native_byte_path(path);
  if (p == NULL) return (double)-nts_errno();
  double r = rmdir_native_path(p);
  free(p);
  return r;
}

static double rename_native_paths(char *a, char *b) {
  uv_fs_t req;
  double r = simple(uv_fs_rename(NULL, &req, a, b, NULL));
  uv_fs_req_cleanup(&req);
  return r;
}

double nts_fs_rename(NtsString *from, NtsString *to) {
  char *a = native_path(from);
  if (a == NULL) return (double)UV_ENOMEM;
  char *b = native_path(to);
  if (b == NULL) {
    free(a);
    return (double)UV_ENOMEM;
  }
  double r = rename_native_paths(a, b);
  free(a);
  free(b);
  return r;
}

/* Both paths as bytes. The TypeScript converts *both* when either side is a
 * Buffer, rather than offering four mixed forms: node accepts any combination,
 * and a string always has a byte spelling while the reverse is not true. */
double nts_fs_rename_bytes(NtsArray *from, NtsArray *to) {
  char *a = native_byte_path(from);
  if (a == NULL) return (double)-nts_errno();
  char *b = native_byte_path(to);
  if (b == NULL) {
    free(a);
    return (double)-nts_errno();
  }
  double r = rename_native_paths(a, b);
  free(a);
  free(b);
  return r;
}

static double copyfile_native_paths(char *a, char *b, double flags) {
  uv_fs_t req;
  double r = simple(uv_fs_copyfile(NULL, &req, a, b, (int)flags, NULL));
  uv_fs_req_cleanup(&req);
  return r;
}

double nts_fs_copyfile(NtsString *from, NtsString *to, double flags) {
  char *a = native_path(from);
  if (a == NULL) return (double)UV_ENOMEM;
  char *b = native_path(to);
  if (b == NULL) {
    free(a);
    return (double)UV_ENOMEM;
  }
  double r = copyfile_native_paths(a, b, flags);
  free(a);
  free(b);
  return r;
}

/* Both paths as bytes. The TypeScript converts *both* when either side is a
 * Buffer, rather than offering four mixed forms: node accepts any combination,
 * and a string always has a byte spelling while the reverse is not true. */
double nts_fs_copyfile_bytes(NtsArray *from, NtsArray *to, double flags) {
  char *a = native_byte_path(from);
  if (a == NULL) return (double)-nts_errno();
  char *b = native_byte_path(to);
  if (b == NULL) {
    free(a);
    return (double)-nts_errno();
  }
  double r = copyfile_native_paths(a, b, flags);
  free(a);
  free(b);
  return r;
}

static double access_native_path(const char *path, double mode) {
  uv_fs_t req;
  double result = simple(uv_fs_access(NULL, &req, path, (int)mode, NULL));
  uv_fs_req_cleanup(&req);
  return result;
}

double nts_fs_access(NtsString *path, double mode) {
  char *native = native_path(path);
  if (native == NULL) return (double)UV_ENOMEM;
  double result = access_native_path(native, mode);
  free(native);
  return result;
}

double nts_fs_access_bytes(NtsArray *path, double mode) {
  char *native = native_byte_path(path);
  if (native == NULL) return (double)-nts_errno();
  double result = access_native_path(native, mode);
  free(native);
  return result;
}

static double chmod_native_path(char *p, double mode) {
  uv_fs_t req;
  double r = simple(uv_fs_chmod(NULL, &req, p, (int)mode, NULL));
  uv_fs_req_cleanup(&req);
  return r;
}

double nts_fs_chmod(NtsString *path, double mode) {
  char *p = native_path(path);
  if (p == NULL) return (double)UV_ENOMEM;
  double r = chmod_native_path(p, mode);
  free(p);
  return r;
}

/* The same call against a path that is already bytes. Node accepts a Buffer
 * wherever it accepts a string path, and a filename need not be valid UTF-8 --
 * decoding one to route it through the string form would rename the file. */
double nts_fs_chmod_bytes(NtsArray *path, double mode) {
  char *p = native_byte_path(path);
  if (p == NULL) return (double)-nts_errno();
  double r = chmod_native_path(p, mode);
  free(p);
  return r;
}

static double chown_native_path(char *p, double uid, double gid) {
  uv_fs_t req;
  double r = simple(uv_fs_chown(NULL, &req, p, (uv_uid_t)uid, (uv_gid_t)gid, NULL));
  uv_fs_req_cleanup(&req);
  return r;
}

double nts_fs_chown(NtsString *path, double uid, double gid) {
  char *p = native_path(path);
  if (p == NULL) return (double)UV_ENOMEM;
  double r = chown_native_path(p, uid, gid);
  free(p);
  return r;
}

/* The same call against a path that is already bytes. Node accepts a Buffer
 * wherever it accepts a string path, and a filename need not be valid UTF-8 --
 * decoding one to route it through the string form would rename the file. */
double nts_fs_chown_bytes(NtsArray *path, double uid, double gid) {
  char *p = native_byte_path(path);
  if (p == NULL) return (double)-nts_errno();
  double r = chown_native_path(p, uid, gid);
  free(p);
  return r;
}

static double lchown_native_path(const char *path, double uid, double gid) {
  uv_fs_t request;
  double result = simple(uv_fs_lchown(
      NULL, &request, path, (uv_uid_t)uid, (uv_gid_t)gid, NULL));
  uv_fs_req_cleanup(&request);
  return result;
}

double nts_fs_lchown(NtsString *path, double uid, double gid) {
  char *native = native_path(path);
  if (native == NULL) return (double)UV_ENOMEM;
  double result = lchown_native_path(native, uid, gid);
  free(native);
  return result;
}

double nts_fs_lchown_bytes(NtsArray *path, double uid, double gid) {
  char *native = native_byte_path(path);
  if (native == NULL) return (double)-nts_errno();
  double result = lchown_native_path(native, uid, gid);
  free(native);
  return result;
}

static double utimes_native_path(char *p, double atime, double mtime) {
  uv_fs_t req;
  double r = simple(uv_fs_utime(NULL, &req, p, atime, mtime, NULL));
  uv_fs_req_cleanup(&req);
  return r;
}

double nts_fs_utimes(NtsString *path, double atime, double mtime) {
  char *p = native_path(path);
  if (p == NULL) return (double)UV_ENOMEM;
  double r = utimes_native_path(p, atime, mtime);
  free(p);
  return r;
}

/* The same call against a path that is already bytes. Node accepts a Buffer
 * wherever it accepts a string path, and a filename need not be valid UTF-8 --
 * decoding one to route it through the string form would rename the file. */
double nts_fs_utimes_bytes(NtsArray *path, double atime, double mtime) {
  char *p = native_byte_path(path);
  if (p == NULL) return (double)-nts_errno();
  double r = utimes_native_path(p, atime, mtime);
  free(p);
  return r;
}

static double link_native_paths(char *a, char *b) {
  uv_fs_t req;
  double r = simple(uv_fs_link(NULL, &req, a, b, NULL));
  uv_fs_req_cleanup(&req);
  return r;
}

double nts_fs_link(NtsString *from, NtsString *to) {
  char *a = native_path(from);
  if (a == NULL) return (double)UV_ENOMEM;
  char *b = native_path(to);
  if (b == NULL) {
    free(a);
    return (double)UV_ENOMEM;
  }
  double r = link_native_paths(a, b);
  free(a);
  free(b);
  return r;
}

/* Both paths as bytes. The TypeScript converts *both* when either side is a
 * Buffer, rather than offering four mixed forms: node accepts any combination,
 * and a string always has a byte spelling while the reverse is not true. */
double nts_fs_link_bytes(NtsArray *from, NtsArray *to) {
  char *a = native_byte_path(from);
  if (a == NULL) return (double)-nts_errno();
  char *b = native_byte_path(to);
  if (b == NULL) {
    free(a);
    return (double)-nts_errno();
  }
  double r = link_native_paths(a, b);
  free(a);
  free(b);
  return r;
}

double nts_fs_symlink(NtsString *target, NtsString *at, double flags) {
  char *a = native_path(target);
  if (a == NULL) return (double)UV_ENOMEM;
  char *b = native_path(at);
  if (b == NULL) {
    free(a);
    return (double)UV_ENOMEM;
  }
  uv_fs_t req;
  double r = simple(uv_fs_symlink(NULL, &req, a, b, (int)flags, NULL));
  free(a);
  free(b);
  uv_fs_req_cleanup(&req);
  return r;
}

double nts_fs_symlink_bytes(NtsArray *target, NtsArray *at, double flags) {
  char *native_target = native_byte_path(target);
  if (native_target == NULL) return -nts_errno();
  char *native_path = native_byte_path(at);
  if (native_path == NULL) {
    free(native_target);
    return -nts_errno();
  }
  uv_fs_t req;
  double result = simple(uv_fs_symlink(NULL, &req, native_target, native_path,
                                       (int)flags, NULL));
  free(native_target);
  free(native_path);
  uv_fs_req_cleanup(&req);
  return result;
}

NtsString *nts_fs_readlink(NtsString *path) {
  char *p = native_path(path);
  if (p == NULL) return empty_string();
  uv_fs_t req;
  int r = uv_fs_readlink(NULL, &req, p, NULL);
  free(p);
  nts_node_set_errno(r);
  NtsString *out = r == 0 ? nts_string_from_utf8((const char *)req.ptr,
                                                 strlen((const char *)req.ptr))
                          : nts_string_from_utf8("", 0);
  uv_fs_req_cleanup(&req);
  return out;
}

/* `readlink` on a byte path. The *target* is returned as bytes too, because a
 * symlink target is no more required to be valid UTF-8 than a filename is, and
 * the string form of this binding would flatten one to replacement characters
 * before the caller ever saw it. */
NtsArray *nts_fs_readlink_bytes(NtsArray *path) {
  char *p = native_byte_path(path);
  if (p == NULL) return empty_doubles();
  uv_fs_t req;
  int r = uv_fs_readlink(NULL, &req, p, NULL);
  free(p);
  nts_node_set_errno(r);
  if (r != 0) {
    uv_fs_req_cleanup(&req);
    return empty_doubles();
  }
  const unsigned char *target = (const unsigned char *)req.ptr;
  size_t length = strlen((const char *)target);
  NtsArray *out = nts_array_new(&nts_node_desc_double, (double)length);
  double *items = NTS_ITEMS(out, double);
  for (size_t i = 0; i < length; i++) items[i] = (double)target[i];
  uv_fs_req_cleanup(&req);
  return out;
}

NtsString *nts_fs_realpath(NtsString *path) {
  char *p = native_path(path);
  if (p == NULL) return empty_string();
  uv_fs_t req;
  int r = uv_fs_realpath(NULL, &req, p, NULL);
  free(p);
  nts_node_set_errno(r);
  NtsString *out = r == 0 ? nts_string_from_utf8((const char *)req.ptr,
                                                 strlen((const char *)req.ptr))
                          : nts_string_from_utf8("", 0);
  uv_fs_req_cleanup(&req);
  return out;
}

NtsArray *nts_fs_realpath_bytes(NtsArray *path) {
  char *native = native_byte_path(path);
  if (native == NULL) return empty_doubles();
  uv_fs_t req;
  int result = uv_fs_realpath(NULL, &req, native, NULL);
  free(native);
  nts_node_set_errno(result);
  NtsArray *out = result == 0
                      ? native_bytes((const char *)req.ptr,
                                     strlen((const char *)req.ptr))
                      : empty_doubles();
  uv_fs_req_cleanup(&req);
  return out;
}

NtsString *nts_fs_mkdtemp(NtsString *template_) {
  char *p = native_path(template_);
  if (p == NULL) return empty_string();
  uv_fs_t req;
  int r = uv_fs_mkdtemp(NULL, &req, p, NULL);
  free(p);
  nts_node_set_errno(r);
  NtsString *out = r == 0 ? nts_string_from_utf8(req.path, strlen(req.path))
                          : nts_string_from_utf8("", 0);
  uv_fs_req_cleanup(&req);
  return out;
}

NtsArray *nts_fs_mkdtemp_bytes(NtsArray *template_) {
  char *path = native_byte_path(template_);
  if (path == NULL) return empty_doubles();
  uv_fs_t req;
  int result = uv_fs_mkdtemp(NULL, &req, path, NULL);
  free(path);
  nts_node_set_errno(result);
  NtsArray *out = result == 0
                      ? native_bytes(req.path, strlen(req.path))
                      : empty_doubles();
  uv_fs_req_cleanup(&req);
  return out;
}

NtsArray *nts_fs_read_file_bytes_fd(double fd, double expected_size) {
  size_t length = 0;
  int error = 0;
  bool size_is_known = expected_size > 0;
  char *data = read_entire_descriptor(
      (uv_file)fd, (size_t)expected_size, !size_is_known, &length, &error);
  nts_node_set_errno(error);
  if (data == NULL) return empty_doubles();

  NtsArray *out = nts_array_new(&nts_node_desc_double, (double)length);
  for (size_t i = 0; i < length; i++) {
    NTS_ITEMS(out, double)[i] = (double)(unsigned char)data[i];
  }
  free(data);
  return out;
}

NtsString *nts_fs_read_file_utf8_fd(double fd) {
  size_t length = 0;
  int error = 0;
  char *data =
      read_entire_descriptor((uv_file)fd, 8192, true, &length, &error);
  nts_node_set_errno(error);
  if (data == NULL) return empty_string();

  NtsString *out = nts_string_from_utf8(data, length);
  free(data);
  return out;
}

/* Write raw bytes. `writeFileSync` takes a string or a `Buffer`, and encoding a
 * `Buffer` into a string to pass it here would re-encode every byte above
 * 0x7f. Two bindings, one per kind of payload. */
double nts_fs_write_file_bytes_fd(double fd, NtsArray *bytes) {
  size_t length = (size_t)bytes->header.length;
  unsigned char *data = malloc(length > 0 ? length : 1);
  if (data == NULL) return simple(UV_ENOMEM);
  for (size_t i = 0; i < length; i++) {
    data[i] = (unsigned char)NTS_ITEMS(bytes, double)[i];
  }
  int error =
      write_entire_descriptor((uv_file)fd, (const char *)data, length);
  free(data);
  return simple(error);
}

/* ------------------------------------------------------------- watchers
 *
 * `fs.watch` and `fs.watchFile` are two different mechanisms and node keeps
 * them apart for a reason worth restating: `watch` asks the platform to tell it
 * (inotify, kqueue, ReadDirectoryChangesW) and reports *events*, while
 * `watchFile` polls `stat` on an interval and reports *two stat snapshots*. One
 * is edge-triggered and cheap, the other is level-triggered and always works.
 * libuv spells them `uv_fs_event_t` and `uv_fs_poll_t`.
 *
 * One table for both, with the kind in the entry, so a handle number is
 * unambiguous across them -- the same shape `net.c` uses and for the same
 * reason: the module holds an integer and must not have to know which pool it
 * came from. */

typedef enum { WATCH_FREE = 0, WATCH_EVENT, WATCH_POLL } WatchKind;

typedef struct {
    WatchKind kind;
    union {
        uv_fs_event_t event;
        uv_fs_poll_t poll;
        uv_handle_t any;
    } h;
    NtsHeader *callback;
    bool bigint;
} Watcher;

static Watcher *watchers = NULL;
static size_t watcher_capacity = 0;

static Watcher *watcher_at(double handle, WatchKind kind) {
    if (!(handle >= 1.0)) return NULL;
    size_t index = (size_t)handle - 1;
    if (index >= watcher_capacity) return NULL;
    Watcher *found = &watchers[index];
    if (found->kind == WATCH_FREE) return NULL;
    if (kind != WATCH_FREE && found->kind != kind) return NULL;
    return found;
}

static Watcher *watcher_claim(void) {
    size_t index = 0;
    while (index < watcher_capacity && watchers[index].kind != WATCH_FREE) {
        index++;
    }
    if (index == watcher_capacity) {
        size_t grown = watcher_capacity == 0 ? 4 : watcher_capacity * 2;
        Watcher *moved = realloc(watchers, grown * sizeof(Watcher));
        if (moved == NULL) return NULL;
        memset(moved + watcher_capacity, 0,
               (grown - watcher_capacity) * sizeof(Watcher));
        watchers = moved;
        watcher_capacity = grown;
    }
    Watcher *entry = &watchers[index];
    memset(entry, 0, sizeof(*entry));
    return entry;
}

static double watcher_index(const Watcher *entry) {
    return (double)((entry - watchers) + 1);
}

static NtsString *watch_utf8(const char *text) {
    return nts_string_from_utf8(text, text == NULL ? 0 : strlen(text));
}

/* The filename as bytes, which is what the declaration asks for and is not an
 * accident: a path is not always valid UTF-8, and node hands back a Buffer for
 * exactly that reason. Handing back a string here would decide an encoding the
 * caller has not asked for and cannot undo. */
static NtsArray *filename_bytes(const char *name) {
    if (name == NULL) return NULL;
    size_t length = strlen(name);
    NtsArray *out = nts_array_new(&nts_node_desc_double, (double)length);
    double *items = NTS_ITEMS(out, double);
    for (size_t i = 0; i < length; i++) {
        items[i] = (double)(unsigned char)name[i];
    }
    return out;
}

static void call_watch_event(NtsHeader *callback, double status,
                             NtsString *event, NtsArray *filename) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *, double, NtsString *, NtsArray *))
         callback->descriptor->methods[nts_closure_call_slot])(callback, status,
                                                               event, filename);
}

static void call_watch_stats(NtsHeader *callback, NtsArray *current,
                             NtsArray *previous) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *, NtsArray *, NtsArray *))
         callback->descriptor->methods[nts_closure_call_slot])(callback, current,
                                                               previous);
}

static void on_fs_event(uv_fs_event_t *handle, const char *filename,
                        int events, int status) {
    Watcher *entry = (Watcher *)handle->data;
    if (entry == NULL) return;
    /* libuv reports rename and change as a bitmask and can set both. Node
     * reports one event name, preferring `rename`, because a rename is the
     * stronger statement: the entry the caller was watching is not the entry
     * that is there now. */
    const char *name = (events & UV_RENAME) != 0 ? "rename" : "change";
    call_watch_event(entry->callback, (double)status, watch_utf8(name),
                     filename_bytes(filename));
}

static void on_fs_poll(uv_fs_poll_t *handle, int status,
                       const uv_stat_t *previous, const uv_stat_t *current) {
    Watcher *entry = (Watcher *)handle->data;
    if (entry == NULL) return;
    if (status != 0) {
        /* A poll that cannot stat reports zeroed snapshots, which is node's
         * behaviour: `watchFile` on a path that does not exist yet fires with
         * an all-zero `Stats` rather than an error, and fires again properly
         * when the path appears. */
        uv_stat_t zero;
        memset(&zero, 0, sizeof(zero));
        call_watch_stats(entry->callback, stat_columns(&zero),
                         stat_columns(&zero));
        return;
    }
    call_watch_stats(entry->callback, stat_columns(current),
                     stat_columns(previous));
}

double nts_fs_watch_start(NtsString *path, bool recursive, bool persistent,
                          bool throw_if_no_entry, NtsHeader *callback) {
    (void)throw_if_no_entry; /* the module raises; this reports the errno */
    char *native = native_path(path);
    if (native == NULL) return (double)UV_ENOMEM;

    Watcher *entry = watcher_claim();
    if (entry == NULL) {
        free(native);
        return (double)UV_ENOMEM;
    }
    int status = uv_fs_event_init(uv_default_loop(), &entry->h.event);
    if (status == 0) {
        entry->h.any.data = entry;
        entry->callback = callback;
        if (callback != NULL) nts_retain(callback);
        status = uv_fs_event_start(&entry->h.event, on_fs_event, native,
                                   recursive ? UV_FS_EVENT_RECURSIVE : 0);
    }
    free(native);
    if (status != 0) {
        if (callback != NULL) nts_release(callback);
        entry->kind = WATCH_FREE;
        return (double)status;
    }
    entry->kind = WATCH_EVENT;
    if (!persistent) uv_unref(&entry->h.any);
    return watcher_index(entry);
}

double nts_fs_watchfile_start(NtsString *path, double interval, bool persistent,
                              bool bigint, NtsHeader *callback) {
    char *native = native_path(path);
    if (native == NULL) return (double)UV_ENOMEM;

    Watcher *entry = watcher_claim();
    if (entry == NULL) {
        free(native);
        return (double)UV_ENOMEM;
    }
    int status = uv_fs_poll_init(uv_default_loop(), &entry->h.poll);
    if (status == 0) {
        entry->h.any.data = entry;
        entry->callback = callback;
        entry->bigint = bigint;
        if (callback != NULL) nts_retain(callback);
        /* libuv takes the interval in milliseconds and treats zero as "as fast
         * as possible", which node's default of 5007 deliberately is not. The
         * module supplies the default; a zero here is a caller's choice. */
        status = uv_fs_poll_start(&entry->h.poll, on_fs_poll, native,
                                  (unsigned int)interval);
    }
    free(native);
    if (status != 0) {
        if (callback != NULL) nts_release(callback);
        entry->kind = WATCH_FREE;
        return (double)status;
    }
    entry->kind = WATCH_POLL;
    if (!persistent) uv_unref(&entry->h.any);
    return watcher_index(entry);
}

static void on_watcher_closed(uv_handle_t *handle) {
    Watcher *entry = (Watcher *)handle->data;
    if (entry == NULL) return;
    if (entry->callback != NULL) nts_release(entry->callback);
    entry->callback = NULL;
    entry->kind = WATCH_FREE;
}

static void watcher_stop(Watcher *entry) {
    if (entry == NULL) return;
    if (uv_is_closing(&entry->h.any)) return;
    if (entry->kind == WATCH_EVENT) {
        uv_fs_event_stop(&entry->h.event);
    } else {
        uv_fs_poll_stop(&entry->h.poll);
    }
    /* Closed rather than freed: libuv owns the handle until its close callback
     * runs, and releasing the callback before then would drop it while an event
     * already queued still names it. */
    uv_close(&entry->h.any, on_watcher_closed);
}

void nts_fs_watch_stop(double handle) {
    watcher_stop(watcher_at(handle, WATCH_EVENT));
}

void nts_fs_watchfile_stop(double handle) {
    watcher_stop(watcher_at(handle, WATCH_POLL));
}

static void watcher_ref(Watcher *entry, bool keep_alive) {
    if (entry == NULL) return;
    if (keep_alive) {
        uv_ref(&entry->h.any);
    } else {
        uv_unref(&entry->h.any);
    }
}

void nts_fs_watch_ref(double handle) {
    watcher_ref(watcher_at(handle, WATCH_EVENT), true);
}
void nts_fs_watch_unref(double handle) {
    watcher_ref(watcher_at(handle, WATCH_EVENT), false);
}
void nts_fs_watchfile_ref(double handle) {
    watcher_ref(watcher_at(handle, WATCH_POLL), true);
}
void nts_fs_watchfile_unref(double handle) {
    watcher_ref(watcher_at(handle, WATCH_POLL), false);
}

/* ------------------------------------------------------- the async surface
 *
 * Every one of these is `uv_fs_*` with a real callback rather than NULL, which
 * is the only difference from the sync half above: libuv runs it on the thread
 * pool and calls back on the loop thread. The request owns whatever it had to
 * allocate -- the paths especially, which libuv does *not* copy and which must
 * outlive the call.
 *
 * Two result shapes cover most of the surface. `FS_STATUS` reports only whether
 * it worked; `FS_NUMBER` reports a number libuv put in `result`, which is the
 * descriptor for `open`, the count for `write`, and zero for the rest. libuv
 * puts a negative errno in the same field, so the split is `result < 0`. */

typedef enum {
    FS_STATUS,
    FS_NUMBER,
    /* Column shapes. The four differ in where the numbers come from and how
     * they are spelled, and every one of them answers an *empty* array on
     * failure rather than a partial one -- which is what the sync half does and
     * what the module reads as "there is nothing here", distinct from a row of
     * zeros that would look like a real stat of an empty thing. */
    FS_STAT,
    FS_STAT_BIGINT,
    FS_STATFS,
    FS_STATFS_BIGINT,
    /* A path the call produced: `mkdtemp` invents one, `readlink` and
     * `realpath` resolve one. Two spellings because a path is not always valid
     * UTF-8 -- the byte form is the one that survives a name the filesystem
     * accepted and the encoding cannot represent. */
    FS_PATH_TEXT,
    FS_PATH_BYTES
} AsyncShape;

typedef struct {
    uv_fs_t request;
    NtsHeader *callback;
    AsyncShape shape;
    /* libuv keeps the pointer, not the bytes. Freed with the request. */
    char *first;
    char *second;
    /* Bytes a write is sending. libuv does not copy them either, so they have
     * to outlive the call exactly as the paths do. */
    char *buffer;
} AsyncRequest;

static void async_call_status(NtsHeader *callback, double errno_value) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *, double))
         callback->descriptor->methods[nts_closure_call_slot])(callback,
                                                               errno_value);
}

static void async_call_number(NtsHeader *callback, double errno_value,
                              double value) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *, double, double))
         callback->descriptor->methods[nts_closure_call_slot])(
        callback, errno_value, value);
}

static void async_call_columns(NtsHeader *callback, double errno_value,
                               NtsArray *columns) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *, double, NtsArray *))
         callback->descriptor->methods[nts_closure_call_slot])(
        callback, errno_value, columns);
}

/* The eight statfs numbers as decimal strings, the same spelling
 * `statfs_bigint_native_path` uses. A `bigint` caller is asking for exactness
 * past 2^53, so the number must not go through a double on the way out. */
static NtsArray *statfs_bigint_of(const void *ptr) {
    uint64_t columns[8];
    statfs_columns(ptr, columns);
    NtsArray *values = nts_array_new(&nts_desc_ref, 8);
    for (size_t index = 0; index < 8; index++) {
        char decimal[32];
        int length =
            snprintf(decimal, sizeof(decimal), "%" PRIu64, columns[index]);
        NTS_ITEMS(values, void *)[index] =
            nts_string_from_utf8(decimal, (size_t)length);
    }
    return values;
}

static NtsArray *statfs_numbers_of(const void *ptr) {
    uint64_t columns[8];
    statfs_columns(ptr, columns);
    NtsArray *values = nts_array_new(&nts_node_desc_double, 8);
    for (size_t index = 0; index < 8; index++) {
        NTS_ITEMS(values, double)[index] = (double)columns[index];
    }
    return values;
}

static void async_call_path(NtsHeader *callback, double errno_value,
                            NtsString *path) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *, double, NtsString *))
         callback->descriptor->methods[nts_closure_call_slot])(
        callback, errno_value, path);
}

/* A path as its bytes. The same reason `filename_bytes` above gives: the
 * filesystem accepted these bytes and an encoding may not be able to name
 * them, so the byte form is the one that cannot lose. */
static NtsArray *path_bytes_of(const char *text) {
    size_t length = text == NULL ? 0 : strlen(text);
    NtsArray *out = nts_array_new(&nts_node_desc_double, (double)length);
    for (size_t i = 0; i < length; i++) {
        NTS_ITEMS(out, double)[i] = (double)(unsigned char)text[i];
    }
    return out;
}

static void on_async_done(uv_fs_t *request) {
    AsyncRequest *pending = (AsyncRequest *)request;
    ssize_t result = request->result;
    double failed = result < 0 ? (double)result : 0.0;

    if (pending->shape == FS_STAT) {
        async_call_columns(pending->callback, failed,
                           result < 0 ? empty_doubles()
                                      : stat_columns(&request->statbuf));
    } else if (pending->shape == FS_STAT_BIGINT) {
        async_call_columns(pending->callback, failed,
                           result < 0 ? nts_array_new(&nts_desc_ref, 0)
                                      : stat_bigint_columns(&request->statbuf));
    } else if (pending->shape == FS_STATFS) {
        async_call_columns(pending->callback, failed,
                           result < 0 ? empty_doubles()
                                      : statfs_numbers_of(request->ptr));
    } else if (pending->shape == FS_STATFS_BIGINT) {
        async_call_columns(pending->callback, failed,
                           result < 0 ? nts_array_new(&nts_desc_ref, 0)
                                      : statfs_bigint_of(request->ptr));
    } else if (pending->shape == FS_PATH_TEXT) {
        /* `mkdtemp` leaves the name in `path`; `readlink` and `realpath` leave
         * it in `ptr`. Whichever is set is the answer, and on failure the empty
         * string is -- the errno beside it is what the module reads. */
        const char *produced = request->ptr != NULL ? (const char *)request->ptr
                                                    : request->path;
        async_call_path(pending->callback, failed,
                        nts_string_from_utf8(
                            result < 0 || produced == NULL ? "" : produced,
                            result < 0 || produced == NULL ? 0
                                                           : strlen(produced)));
    } else if (pending->shape == FS_PATH_BYTES) {
        const char *produced = request->ptr != NULL ? (const char *)request->ptr
                                                    : request->path;
        async_call_columns(pending->callback, failed,
                           result < 0 || produced == NULL
                               ? empty_doubles()
                               : path_bytes_of(produced));
    } else if (pending->shape == FS_NUMBER) {
        async_call_number(pending->callback, failed,
                          result < 0 ? 0.0 : (double)result);
    } else {
        async_call_status(pending->callback, failed);
    }

    if (pending->callback != NULL) nts_release(pending->callback);
    uv_fs_req_cleanup(request);
    free(pending->first);
    free(pending->second);
    free(pending->buffer);
    free(pending);
}

/* A request, with its callback retained and its paths owned. Returns NULL only
 * out of memory, and the caller reports that itself: there is no request to
 * carry the answer back on. */
static AsyncRequest *async_new(NtsHeader *callback, AsyncShape shape,
                               char *first, char *second) {
    AsyncRequest *pending = calloc(1, sizeof(AsyncRequest));
    if (pending == NULL) {
        free(first);
        free(second);
        return NULL;
    }
    pending->callback = callback;
    pending->shape = shape;
    pending->first = first;
    pending->second = second;
    if (callback != NULL) nts_retain(callback);
    return pending;
}

/* Report a failure that happened before libuv was reached. The callback still
 * runs, and it runs *later* rather than now: a binding that calls back
 * synchronously on the error path and asynchronously on the success path is the
 * shape node's own documentation warns about, and the module above would have
 * to defend against it. `uv_fs_*` on a path that cannot exist gives the same
 * deferral for free, so this is only for allocation failure. */
static void async_fail(NtsHeader *callback, AsyncShape shape, double errno_value,
                       AsyncRequest *pending) {
    if (pending != NULL) {
        if (pending->callback != NULL) nts_release(pending->callback);
        free(pending->first);
        free(pending->second);
        free(pending);
    }
    switch (shape) {
    case FS_NUMBER:
        async_call_number(callback, errno_value, 0.0);
        break;
    case FS_STAT:
    case FS_STATFS:
        async_call_columns(callback, errno_value, empty_doubles());
        break;
    case FS_STAT_BIGINT:
    case FS_STATFS_BIGINT:
        async_call_columns(callback, errno_value, nts_array_new(&nts_desc_ref, 0));
        break;
    case FS_PATH_TEXT:
        async_call_path(callback, errno_value, nts_string_from_utf8("", 0));
        break;
    case FS_PATH_BYTES:
        async_call_columns(callback, errno_value, empty_doubles());
        break;
    default:
        async_call_status(callback, errno_value);
        break;
    }
}

static uv_loop_t *fs_loop(void) { return uv_default_loop(); }

/* One macro's worth of shape repeated by hand, because the bodies differ in
 * which `uv_fs_*` they call and in how many arguments it takes, and a macro
 * that covered all of them would take the call as a token and read worse than
 * the calls do. */

#define ASYNC_BEGIN(shape_, first_, second_)                                   \
    AsyncRequest *pending = async_new(callback, (shape_), (first_), (second_)); \
    if (pending == NULL) {                                                     \
        async_fail(callback, (shape_), (double)UV_ENOMEM, NULL);               \
        return;                                                                \
    }

#define ASYNC_END(shape_, call_)                                               \
    int status = (call_);                                                      \
    if (status != 0) async_fail(callback, (shape_), (double)status, pending);

void nts_fs_access_async(NtsString *path, double mode, NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, native_path(path), NULL)
    ASYNC_END(FS_STATUS, uv_fs_access(fs_loop(), &pending->request,
                                      pending->first, (int)mode, on_async_done))
}

void nts_fs_access_bytes_async(NtsArray *path, double mode,
                               NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, native_byte_path(path), NULL)
    ASYNC_END(FS_STATUS, uv_fs_access(fs_loop(), &pending->request,
                                      pending->first, (int)mode, on_async_done))
}

void nts_fs_chmod_async(NtsString *path, double mode, NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, native_path(path), NULL)
    ASYNC_END(FS_STATUS, uv_fs_chmod(fs_loop(), &pending->request,
                                     pending->first, (int)mode, on_async_done))
}

void nts_fs_chmod_async_bytes(NtsArray *path, double mode,
                              NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, native_byte_path(path), NULL)
    ASYNC_END(FS_STATUS, uv_fs_chmod(fs_loop(), &pending->request,
                                     pending->first, (int)mode, on_async_done))
}

void nts_fs_chown_async(NtsString *path, double uid, double gid,
                        NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, native_path(path), NULL)
    ASYNC_END(FS_STATUS,
              uv_fs_chown(fs_loop(), &pending->request, pending->first,
                          (uv_uid_t)uid, (uv_gid_t)gid, on_async_done))
}

void nts_fs_chown_async_bytes(NtsArray *path, double uid, double gid,
                              NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, native_byte_path(path), NULL)
    ASYNC_END(FS_STATUS,
              uv_fs_chown(fs_loop(), &pending->request, pending->first,
                          (uv_uid_t)uid, (uv_gid_t)gid, on_async_done))
}

void nts_fs_close_async(double descriptor, NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, NULL, NULL)
    ASYNC_END(FS_STATUS, uv_fs_close(fs_loop(), &pending->request,
                                     (uv_file)descriptor, on_async_done))
}

void nts_fs_copyfile_async(NtsString *from, NtsString *to, double flags,
                           NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, native_path(from), native_path(to))
    ASYNC_END(FS_STATUS,
              uv_fs_copyfile(fs_loop(), &pending->request, pending->first,
                             pending->second, (int)flags, on_async_done))
}

void nts_fs_copyfile_async_bytes(NtsArray *from, NtsArray *to, double flags,
                                 NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, native_byte_path(from), native_byte_path(to))
    ASYNC_END(FS_STATUS,
              uv_fs_copyfile(fs_loop(), &pending->request, pending->first,
                             pending->second, (int)flags, on_async_done))
}

void nts_fs_fchmod_async(double fd, double mode, NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, NULL, NULL)
    ASYNC_END(FS_STATUS, uv_fs_fchmod(fs_loop(), &pending->request,
                                      (uv_file)fd, (int)mode, on_async_done))
}

void nts_fs_fchown_async(double fd, double uid, double gid,
                         NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, NULL, NULL)
    ASYNC_END(FS_STATUS,
              uv_fs_fchown(fs_loop(), &pending->request, (uv_file)fd,
                           (uv_uid_t)uid, (uv_gid_t)gid, on_async_done))
}

void nts_fs_fdatasync_async(double fd, NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, NULL, NULL)
    ASYNC_END(FS_STATUS, uv_fs_fdatasync(fs_loop(), &pending->request,
                                         (uv_file)fd, on_async_done))
}

void nts_fs_fsync_async(double fd, NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, NULL, NULL)
    ASYNC_END(FS_STATUS, uv_fs_fsync(fs_loop(), &pending->request, (uv_file)fd,
                                     on_async_done))
}

void nts_fs_ftruncate_async(double fd, double length, NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, NULL, NULL)
    ASYNC_END(FS_STATUS, uv_fs_ftruncate(fs_loop(), &pending->request,
                                         (uv_file)fd, (int64_t)length,
                                         on_async_done))
}

void nts_fs_futimes_async(double fd, double atime, double mtime,
                          NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, NULL, NULL)
    ASYNC_END(FS_STATUS, uv_fs_futime(fs_loop(), &pending->request,
                                      (uv_file)fd, atime, mtime,
                                      on_async_done))
}

void nts_fs_lchown_async(NtsString *path, double uid, double gid,
                         NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, native_path(path), NULL)
    ASYNC_END(FS_STATUS,
              uv_fs_lchown(fs_loop(), &pending->request, pending->first,
                           (uv_uid_t)uid, (uv_gid_t)gid, on_async_done))
}

void nts_fs_lchown_bytes_async(NtsArray *path, double uid, double gid,
                               NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, native_byte_path(path), NULL)
    ASYNC_END(FS_STATUS,
              uv_fs_lchown(fs_loop(), &pending->request, pending->first,
                           (uv_uid_t)uid, (uv_gid_t)gid, on_async_done))
}

void nts_fs_link_async(NtsString *from, NtsString *to, NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, native_path(from), native_path(to))
    ASYNC_END(FS_STATUS, uv_fs_link(fs_loop(), &pending->request,
                                    pending->first, pending->second,
                                    on_async_done))
}

void nts_fs_link_async_bytes(NtsArray *from, NtsArray *to,
                             NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, native_byte_path(from), native_byte_path(to))
    ASYNC_END(FS_STATUS, uv_fs_link(fs_loop(), &pending->request,
                                    pending->first, pending->second,
                                    on_async_done))
}

void nts_fs_lutimes_async(NtsString *path, double atime, double mtime,
                          NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, native_path(path), NULL)
    ASYNC_END(FS_STATUS, uv_fs_lutime(fs_loop(), &pending->request,
                                      pending->first, atime, mtime,
                                      on_async_done))
}

void nts_fs_rename_async(NtsString *from, NtsString *to, NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, native_path(from), native_path(to))
    ASYNC_END(FS_STATUS, uv_fs_rename(fs_loop(), &pending->request,
                                      pending->first, pending->second,
                                      on_async_done))
}

void nts_fs_rename_async_bytes(NtsArray *from, NtsArray *to,
                               NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, native_byte_path(from), native_byte_path(to))
    ASYNC_END(FS_STATUS, uv_fs_rename(fs_loop(), &pending->request,
                                      pending->first, pending->second,
                                      on_async_done))
}

void nts_fs_rmdir_async(NtsString *path, NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, native_path(path), NULL)
    ASYNC_END(FS_STATUS, uv_fs_rmdir(fs_loop(), &pending->request,
                                     pending->first, on_async_done))
}

void nts_fs_rmdir_async_bytes(NtsArray *path, NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, native_byte_path(path), NULL)
    ASYNC_END(FS_STATUS, uv_fs_rmdir(fs_loop(), &pending->request,
                                     pending->first, on_async_done))
}

void nts_fs_symlink_async(NtsString *target, NtsString *at, double flags,
                          NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, native_path(target), native_path(at))
    ASYNC_END(FS_STATUS,
              uv_fs_symlink(fs_loop(), &pending->request, pending->first,
                            pending->second, (int)flags, on_async_done))
}

void nts_fs_symlink_bytes_async(NtsArray *target, NtsArray *at, double flags,
                                NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, native_byte_path(target), native_byte_path(at))
    ASYNC_END(FS_STATUS,
              uv_fs_symlink(fs_loop(), &pending->request, pending->first,
                            pending->second, (int)flags, on_async_done))
}

void nts_fs_unlink_async(NtsString *path, NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, native_path(path), NULL)
    ASYNC_END(FS_STATUS, uv_fs_unlink(fs_loop(), &pending->request,
                                      pending->first, on_async_done))
}

void nts_fs_unlink_async_bytes(NtsArray *path, NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, native_byte_path(path), NULL)
    ASYNC_END(FS_STATUS, uv_fs_unlink(fs_loop(), &pending->request,
                                      pending->first, on_async_done))
}

void nts_fs_utimes_async(NtsString *path, double atime, double mtime,
                         NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, native_path(path), NULL)
    ASYNC_END(FS_STATUS, uv_fs_utime(fs_loop(), &pending->request,
                                     pending->first, atime, mtime,
                                     on_async_done))
}

void nts_fs_utimes_async_bytes(NtsArray *path, double atime, double mtime,
                               NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATUS, native_byte_path(path), NULL)
    ASYNC_END(FS_STATUS, uv_fs_utime(fs_loop(), &pending->request,
                                     pending->first, atime, mtime,
                                     on_async_done))
}

void nts_fs_open_async(NtsString *path, double flags, double mode,
                       NtsHeader *callback) {
    ASYNC_BEGIN(FS_NUMBER, native_path(path), NULL)
    ASYNC_END(FS_NUMBER,
              uv_fs_open(fs_loop(), &pending->request, pending->first,
                         (int)flags, (int)mode, on_async_done))
}

void nts_fs_open_bytes_async(NtsArray *path, double flags, double mode,
                             NtsHeader *callback) {
    ASYNC_BEGIN(FS_NUMBER, native_byte_path(path), NULL)
    ASYNC_END(FS_NUMBER,
              uv_fs_open(fs_loop(), &pending->request, pending->first,
                         (int)flags, (int)mode, on_async_done))
}

/* The stat family. Ten bindings, four shapes, one difference between them:
 * whether the numbers come from `statbuf` or from the `statfs` block, and
 * whether they are spelled as doubles or as decimal strings. */

void nts_fs_stat_async(NtsString *path, bool follow, NtsHeader *callback) {
    ASYNC_BEGIN(FS_STAT, native_path(path), NULL)
    ASYNC_END(FS_STAT,
              follow ? uv_fs_stat(fs_loop(), &pending->request, pending->first,
                                  on_async_done)
                     : uv_fs_lstat(fs_loop(), &pending->request, pending->first,
                                   on_async_done))
}

void nts_fs_stat_bytes_async(NtsArray *path, bool follow, NtsHeader *callback) {
    ASYNC_BEGIN(FS_STAT, native_byte_path(path), NULL)
    ASYNC_END(FS_STAT,
              follow ? uv_fs_stat(fs_loop(), &pending->request, pending->first,
                                  on_async_done)
                     : uv_fs_lstat(fs_loop(), &pending->request, pending->first,
                                   on_async_done))
}

void nts_fs_stat_bigint_async(NtsString *path, bool follow,
                              NtsHeader *callback) {
    ASYNC_BEGIN(FS_STAT_BIGINT, native_path(path), NULL)
    ASYNC_END(FS_STAT_BIGINT,
              follow ? uv_fs_stat(fs_loop(), &pending->request, pending->first,
                                  on_async_done)
                     : uv_fs_lstat(fs_loop(), &pending->request, pending->first,
                                   on_async_done))
}

void nts_fs_stat_bigint_bytes_async(NtsArray *path, bool follow,
                                    NtsHeader *callback) {
    ASYNC_BEGIN(FS_STAT_BIGINT, native_byte_path(path), NULL)
    ASYNC_END(FS_STAT_BIGINT,
              follow ? uv_fs_stat(fs_loop(), &pending->request, pending->first,
                                  on_async_done)
                     : uv_fs_lstat(fs_loop(), &pending->request, pending->first,
                                   on_async_done))
}

void nts_fs_fstat_async(double fd, NtsHeader *callback) {
    ASYNC_BEGIN(FS_STAT, NULL, NULL)
    ASYNC_END(FS_STAT, uv_fs_fstat(fs_loop(), &pending->request, (uv_file)fd,
                                   on_async_done))
}

void nts_fs_fstat_bigint_async(double fd, NtsHeader *callback) {
    ASYNC_BEGIN(FS_STAT_BIGINT, NULL, NULL)
    ASYNC_END(FS_STAT_BIGINT, uv_fs_fstat(fs_loop(), &pending->request,
                                          (uv_file)fd, on_async_done))
}

void nts_fs_statfs_async(NtsString *path, NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATFS, native_path(path), NULL)
    ASYNC_END(FS_STATFS, uv_fs_statfs(fs_loop(), &pending->request,
                                      pending->first, on_async_done))
}

void nts_fs_statfs_bytes_async(NtsArray *path, NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATFS, native_byte_path(path), NULL)
    ASYNC_END(FS_STATFS, uv_fs_statfs(fs_loop(), &pending->request,
                                      pending->first, on_async_done))
}

void nts_fs_statfs_bigint_async(NtsString *path, NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATFS_BIGINT, native_path(path), NULL)
    ASYNC_END(FS_STATFS_BIGINT, uv_fs_statfs(fs_loop(), &pending->request,
                                             pending->first, on_async_done))
}

void nts_fs_statfs_bigint_bytes_async(NtsArray *path, NtsHeader *callback) {
    ASYNC_BEGIN(FS_STATFS_BIGINT, native_byte_path(path), NULL)
    ASYNC_END(FS_STATFS_BIGINT, uv_fs_statfs(fs_loop(), &pending->request,
                                             pending->first, on_async_done))
}

/* Paths a call produces, and the two writes. */

void nts_fs_mkdtemp_async(NtsString *template_path, NtsHeader *callback) {
    ASYNC_BEGIN(FS_PATH_TEXT, native_path(template_path), NULL)
    ASYNC_END(FS_PATH_TEXT, uv_fs_mkdtemp(fs_loop(), &pending->request,
                                          pending->first, on_async_done))
}

void nts_fs_mkdtemp_bytes_async(NtsArray *template_path, NtsHeader *callback) {
    ASYNC_BEGIN(FS_PATH_BYTES, native_byte_path(template_path), NULL)
    ASYNC_END(FS_PATH_BYTES, uv_fs_mkdtemp(fs_loop(), &pending->request,
                                           pending->first, on_async_done))
}

void nts_fs_readlink_async(NtsString *path, NtsHeader *callback) {
    ASYNC_BEGIN(FS_PATH_TEXT, native_path(path), NULL)
    ASYNC_END(FS_PATH_TEXT, uv_fs_readlink(fs_loop(), &pending->request,
                                           pending->first, on_async_done))
}

void nts_fs_readlink_async_bytes(NtsArray *path, NtsHeader *callback) {
    ASYNC_BEGIN(FS_PATH_BYTES, native_byte_path(path), NULL)
    ASYNC_END(FS_PATH_BYTES, uv_fs_readlink(fs_loop(), &pending->request,
                                            pending->first, on_async_done))
}

void nts_fs_realpath_async(NtsString *path, NtsHeader *callback) {
    ASYNC_BEGIN(FS_PATH_TEXT, native_path(path), NULL)
    ASYNC_END(FS_PATH_TEXT, uv_fs_realpath(fs_loop(), &pending->request,
                                           pending->first, on_async_done))
}

void nts_fs_realpath_bytes_async(NtsArray *path, NtsHeader *callback) {
    ASYNC_BEGIN(FS_PATH_BYTES, native_byte_path(path), NULL)
    ASYNC_END(FS_PATH_BYTES, uv_fs_realpath(fs_loop(), &pending->request,
                                            pending->first, on_async_done))
}

/* The bytes of a `number[]`, copied because libuv keeps the pointer and the
 * array belongs to the compiled program, which may collect or move it while
 * the write is on the thread pool. */
static char *bytes_of_array(const NtsArray *bytes, size_t *length_out) {
    size_t length = bytes == NULL ? 0 : (size_t)bytes->header.length;
    char *copy = malloc(length == 0 ? 1 : length);
    if (copy == NULL) return NULL;
    for (size_t i = 0; i < length; i++) {
        copy[i] = (char)(unsigned char)NTS_ITEMS((NtsArray *)bytes, double)[i];
    }
    *length_out = length;
    return copy;
}

void nts_fs_write_async(double fd, NtsArray *bytes, double position,
                        NtsHeader *callback) {
    ASYNC_BEGIN(FS_NUMBER, NULL, NULL)
    size_t length = 0;
    pending->buffer = bytes_of_array(bytes, &length);
    if (pending->buffer == NULL) {
        async_fail(callback, FS_NUMBER, (double)UV_ENOMEM, pending);
        return;
    }
    uv_buf_t one = uv_buf_init(pending->buffer, (unsigned int)length);
    ASYNC_END(FS_NUMBER,
              uv_fs_write(fs_loop(), &pending->request, (uv_file)fd, &one, 1,
                          (int64_t)position, on_async_done))
}

/* `writev` takes one flat byte array plus the length of each slice, because a
 * `number[][]` has no representation that crosses. The slices are views into
 * the one copy, so there is still exactly one allocation to outlive the call. */
void nts_fs_writev_async(double fd, NtsArray *bytes, NtsArray *lengths,
                         double position, NtsHeader *callback) {
    ASYNC_BEGIN(FS_NUMBER, NULL, NULL)
    size_t total = 0;
    pending->buffer = bytes_of_array(bytes, &total);
    if (pending->buffer == NULL) {
        async_fail(callback, FS_NUMBER, (double)UV_ENOMEM, pending);
        return;
    }
    size_t count = lengths == NULL ? 0 : (size_t)lengths->header.length;
    uv_buf_t *slices = count == 0 ? NULL : calloc(count, sizeof(uv_buf_t));
    if (count != 0 && slices == NULL) {
        async_fail(callback, FS_NUMBER, (double)UV_ENOMEM, pending);
        return;
    }
    size_t offset = 0;
    for (size_t i = 0; i < count; i++) {
        size_t slice = (size_t)NTS_ITEMS(lengths, double)[i];
        if (offset + slice > total) slice = total > offset ? total - offset : 0;
        slices[i] = uv_buf_init(pending->buffer + offset, (unsigned int)slice);
        offset += slice;
    }
    int status = uv_fs_write(fs_loop(), &pending->request, (uv_file)fd, slices,
                             (unsigned int)count, (int64_t)position,
                             on_async_done);
    /* libuv copies the `uv_buf_t` array itself, unlike the bytes it points at,
     * so the slice table is this function's to free either way. */
    free(slices);
    if (status != 0) async_fail(callback, FS_NUMBER, (double)status, pending);
}

/* ---------------------------------------------------------------- mkdir
 *
 * libuv has no recursive `mkdir`, so recursion is a chain of them: one request
 * per path component, left to right, treating `EEXIST` as "already there" and
 * carrying on.
 *
 * The interesting part of the contract is not the recursion, it is what comes
 * back. Node reports **the first directory it actually had to create**, so a
 * caller can undo exactly what the call did and no more -- removing a tree that
 * was already there would be destroying somebody else's directory. So `first`
 * is set once, on the first component whose `mkdir` succeeds, and never
 * updated.
 *
 * Non-recursive is the same machine with the walk skipped: one component, the
 * whole path, and `first` unset because the caller already knows the name. */

typedef struct {
    uv_fs_t request;
    NtsHeader *callback;
    char *path;      /* owned; prefixes are terminated in place and restored */
    size_t length;
    size_t cursor;   /* how far along `path` the chain has got */
    int mode;
    bool recursive;
    char *first;     /* owned; the first component this call created */
    bool done;
} MkdirChain;

static void mkdir_finish(MkdirChain *chain, double errno_value) {
    if (chain->callback != NULL) {
        const char *first = chain->first == NULL ? "" : chain->first;
        async_call_path(chain->callback, errno_value,
                        nts_string_from_utf8(first, strlen(first)));
        nts_release(chain->callback);
    }
    uv_fs_req_cleanup(&chain->request);
    free(chain->path);
    free(chain->first);
    free(chain);
}

static void mkdir_step(MkdirChain *chain);

static void on_mkdir_step(uv_fs_t *request) {
    MkdirChain *chain = (MkdirChain *)request;
    ssize_t result = request->result;
    uv_fs_req_cleanup(request);

    if (result == 0 && chain->first == NULL) {
        /* The first one this call actually made. `request->path` is the prefix
         * as it stood, which is why the terminator is restored *after* this. */
        chain->first = strdup(chain->path);
    }
    /* Restore the separator the step replaced, so the next prefix is longer
     * rather than a different string. */
    if (chain->cursor < chain->length) chain->path[chain->cursor] = '/';

    if (result != 0 && result != UV_EEXIST) {
        mkdir_finish(chain, (double)result);
        return;
    }
    if (chain->done) {
        mkdir_finish(chain, 0.0);
        return;
    }
    mkdir_step(chain);
}

static void mkdir_step(MkdirChain *chain) {
    if (!chain->recursive) {
        chain->done = true;
        chain->cursor = chain->length;
        int status = uv_fs_mkdir(fs_loop(), &chain->request, chain->path,
                                 chain->mode, on_mkdir_step);
        if (status != 0) mkdir_finish(chain, (double)status);
        return;
    }
    /* The next separator after what has already been made. A leading slash is
     * skipped rather than treated as an empty component, which would ask for
     * `mkdir("")`. */
    size_t at = chain->cursor;
    while (at < chain->length && chain->path[at] == '/') at++;
    while (at < chain->length && chain->path[at] != '/') at++;
    chain->cursor = at;
    chain->done = at >= chain->length;
    if (at < chain->length) chain->path[at] = '\0';

    int status = uv_fs_mkdir(fs_loop(), &chain->request, chain->path,
                             chain->mode, on_mkdir_step);
    if (status != 0) {
        if (at < chain->length) chain->path[at] = '/';
        mkdir_finish(chain, (double)status);
    }
}

static void mkdir_start(char *native, double mode, bool recursive,
                        NtsHeader *callback) {
    if (native == NULL) {
        async_call_path(callback, (double)UV_ENOMEM,
                        nts_string_from_utf8("", 0));
        return;
    }
    MkdirChain *chain = calloc(1, sizeof(MkdirChain));
    if (chain == NULL) {
        free(native);
        async_call_path(callback, (double)UV_ENOMEM,
                        nts_string_from_utf8("", 0));
        return;
    }
    chain->callback = callback;
    if (callback != NULL) nts_retain(callback);
    chain->path = native;
    chain->length = strlen(native);
    chain->mode = (int)mode;
    chain->recursive = recursive;
    mkdir_step(chain);
}

void nts_fs_mkdir_async(NtsString *path, double mode, bool recursive,
                        NtsHeader *callback) {
    mkdir_start(native_path(path), mode, recursive, callback);
}

void nts_fs_mkdir_async_bytes(NtsArray *path, double mode, bool recursive,
                              NtsHeader *callback) {
    mkdir_start(native_byte_path(path), mode, recursive, callback);
}

/* ------------------------------------------------------ reads and entries
 *
 * Three more shapes. `FS_READ` reports what a read got and the bytes it got;
 * `FS_ROWS` reports directory entries the same way the sync half does, through
 * `dirent_rows`; `FS_DIR` registers an opened directory and reports its handle.
 *
 * All three reuse the sync half's helpers rather than growing a second copy:
 * `dirent_rows` decides the row layout and `register_directory` owns the
 * numbering, and both are things the module already agrees with. */

typedef struct {
    uv_fs_t request;
    NtsHeader *callback;
    char *path;      /* owned, for the opendir and scandir forms */
    char *buffer;    /* owned, for the read forms */
    size_t capacity;
    bool rows;       /* scandir rather than opendir, on the same struct */
} ExtraRequest;

static void async_call_read(NtsHeader *callback, double errno_value,
                            double count, NtsArray *bytes) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *, double, double, NtsArray *))
         callback->descriptor->methods[nts_closure_call_slot])(
        callback, errno_value, count, bytes);
}

static NtsArray *bytes_as_numbers(const char *bytes, size_t length) {
    NtsArray *out = nts_array_new(&nts_node_desc_double, (double)length);
    for (size_t i = 0; i < length; i++) {
        NTS_ITEMS(out, double)[i] = (double)(unsigned char)bytes[i];
    }
    return out;
}

static void extra_finish(ExtraRequest *extra) {
    if (extra->callback != NULL) nts_release(extra->callback);
    uv_fs_req_cleanup(&extra->request);
    free(extra->path);
    free(extra->buffer);
    free(extra);
}

static void on_read_done(uv_fs_t *request) {
    ExtraRequest *extra = (ExtraRequest *)request;
    ssize_t result = request->result;
    /* A short read is not an error and neither is end of file: libuv reports
     * both as a count, and zero means the file had nothing more. The module
     * decides what that means for the caller. */
    async_call_read(extra->callback, result < 0 ? (double)result : 0.0,
                    result < 0 ? 0.0 : (double)result,
                    result < 0 ? nts_array_new(&nts_node_desc_double, 0)
                               : bytes_as_numbers(extra->buffer,
                                                  (size_t)result));
    extra_finish(extra);
}

static void read_start(double fd, double length, double position,
                       NtsHeader *callback) {
    ExtraRequest *extra = calloc(1, sizeof(ExtraRequest));
    if (extra == NULL) {
        async_call_read(callback, (double)UV_ENOMEM, 0.0,
                        nts_array_new(&nts_node_desc_double, 0));
        return;
    }
    extra->capacity = length < 0.0 ? 0 : (size_t)length;
    extra->buffer = malloc(extra->capacity == 0 ? 1 : extra->capacity);
    extra->callback = callback;
    if (extra->buffer == NULL) {
        free(extra);
        async_call_read(callback, (double)UV_ENOMEM, 0.0,
                        nts_array_new(&nts_node_desc_double, 0));
        return;
    }
    if (callback != NULL) nts_retain(callback);
    uv_buf_t one = uv_buf_init(extra->buffer, (unsigned int)extra->capacity);
    int status = uv_fs_read(fs_loop(), &extra->request, (uv_file)fd, &one, 1,
                            (int64_t)position, on_read_done);
    if (status != 0) {
        async_call_read(callback, (double)status, 0.0,
                        nts_array_new(&nts_node_desc_double, 0));
        extra_finish(extra);
    }
}

void nts_fs_read_async(double descriptor, double length, double position,
                       NtsHeader *callback) {
    read_start(descriptor, length, position, callback);
}

/* The bigint form differs only in how the caller spelled the offset. It has
 * already become a double by the time it is here, so there is one
 * implementation and not two -- and the note is worth leaving, because a
 * reader looking for where the 64-bit path went should find this rather than
 * conclude it was forgotten. */
void nts_fs_read_bigint_async(double fd, double length, double position,
                              NtsHeader *callback) {
    read_start(fd, length, position, callback);
}

/* `readv` takes the slice lengths and answers one flat array, mirroring how
 * `writev` takes one. Reading into separate buffers and concatenating would
 * give the same bytes and one more copy. */
void nts_fs_readv_async(double fd, NtsArray *lengths, double position,
                        NtsHeader *callback) {
    size_t total = 0;
    size_t count = lengths == NULL ? 0 : (size_t)lengths->header.length;
    for (size_t i = 0; i < count; i++) {
        double each = NTS_ITEMS(lengths, double)[i];
        if (each > 0.0) total += (size_t)each;
    }
    read_start(fd, (double)total, position, callback);
}

static void on_scandir_done(uv_fs_t *request) {
    ExtraRequest *extra = (ExtraRequest *)request;
    ssize_t count = request->result;
    if (count < 0) {
        async_call_columns(extra->callback, (double)count,
                           nts_array_new(&nts_desc_ref, 0));
        extra_finish(extra);
        return;
    }
    uv_dirent_t *entries = calloc((size_t)count == 0 ? 1 : (size_t)count,
                                  sizeof(*entries));
    if (entries == NULL) {
        async_call_columns(extra->callback, (double)UV_ENOMEM,
                           nts_array_new(&nts_desc_ref, 0));
        extra_finish(extra);
        return;
    }
    for (ssize_t index = 0; index < count; index++) {
        if (uv_fs_scandir_next(request, &entries[index]) < 0) {
            /* Fewer entries than the count promised is a directory that
             * changed underneath the walk. The sync half reports EIO for it and
             * so does this: a partial list would look like a complete one. */
            free(entries);
            async_call_columns(extra->callback, (double)UV_EIO,
                               nts_array_new(&nts_desc_ref, 0));
            extra_finish(extra);
            return;
        }
    }
    async_call_columns(extra->callback, 0.0,
                       dirent_rows(entries, (size_t)count));
    free(entries);
    extra_finish(extra);
}

static void scandir_start(char *native, NtsHeader *callback) {
    if (native == NULL) {
        async_call_columns(callback, (double)UV_ENOMEM,
                           nts_array_new(&nts_desc_ref, 0));
        return;
    }
    ExtraRequest *extra = calloc(1, sizeof(ExtraRequest));
    if (extra == NULL) {
        free(native);
        async_call_columns(callback, (double)UV_ENOMEM,
                           nts_array_new(&nts_desc_ref, 0));
        return;
    }
    extra->path = native;
    extra->callback = callback;
    if (callback != NULL) nts_retain(callback);
    int status = uv_fs_scandir(fs_loop(), &extra->request, extra->path, 0,
                               on_scandir_done);
    if (status != 0) {
        async_call_columns(callback, (double)status,
                           nts_array_new(&nts_desc_ref, 0));
        extra_finish(extra);
    }
}

void nts_fs_scandir_async(NtsString *path, NtsHeader *callback) {
    scandir_start(native_path(path), callback);
}

void nts_fs_scandir_bytes_async(NtsArray *path, NtsHeader *callback) {
    scandir_start(native_byte_path(path), callback);
}

static void on_opendir_done(uv_fs_t *request) {
    ExtraRequest *extra = (ExtraRequest *)request;
    ssize_t result = request->result;
    if (result < 0) {
        async_call_number(extra->callback, (double)result, 0.0);
        extra_finish(extra);
        return;
    }
    NtsFsDirectory *entry = calloc(1, sizeof(NtsFsDirectory));
    if (entry == NULL) {
        uv_fs_t closing;
        uv_fs_closedir(NULL, &closing, (uv_dir_t *)request->ptr, NULL);
        uv_fs_req_cleanup(&closing);
        async_call_number(extra->callback, (double)UV_ENOMEM, 0.0);
        extra_finish(extra);
        return;
    }
    entry->directory = (uv_dir_t *)request->ptr;
    /* Registered through the sync half's own numbering, so a handle from an
     * async open and one from a sync open cannot collide and either can be
     * read or closed by either form. */
    double handle = register_directory(entry);
    async_call_number(extra->callback, 0.0, handle);
    extra_finish(extra);
}

static void opendir_start(char *native, NtsHeader *callback) {
    if (native == NULL) {
        async_call_number(callback, (double)UV_ENOMEM, 0.0);
        return;
    }
    ExtraRequest *extra = calloc(1, sizeof(ExtraRequest));
    if (extra == NULL) {
        free(native);
        async_call_number(callback, (double)UV_ENOMEM, 0.0);
        return;
    }
    extra->path = native;
    extra->callback = callback;
    if (callback != NULL) nts_retain(callback);
    int status = uv_fs_opendir(fs_loop(), &extra->request, extra->path,
                               on_opendir_done);
    if (status != 0) {
        async_call_number(callback, (double)status, 0.0);
        extra_finish(extra);
    }
}

void nts_fs_opendir_async(NtsString *path, NtsHeader *callback) {
    opendir_start(native_path(path), callback);
}

void nts_fs_opendir_bytes_async(NtsArray *path, NtsHeader *callback) {
    opendir_start(native_byte_path(path), callback);
}
