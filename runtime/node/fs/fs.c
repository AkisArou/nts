/* The native half of `node:fs`, sync surface.
 *
 * Every function is one `uv_fs_*` call with a NULL callback, which is how
 * node's own `SyncCall` runs them, plus the conversion between `NtsString` and
 * the UTF-8 libuv takes. Node's `src/node_file.cc` is the same shape with
 * `v8::Local` where these have `NtsString`.
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
  NtsArray *bytes = nts_array_new(&nts_desc_double, (double)length);
  double *items = NTS_ITEMS(bytes, double);
  for (size_t i = 0; i < length; i++) {
    items[i] = (double)(unsigned char)value[i];
  }
  return bytes;
}

static NtsArray *empty_doubles(void) {
  return nts_array_new(&nts_desc_double, 0);
}

static NtsString *empty_string(void) {
  return nts_string_from_utf8("", 0);
}

double nts_fs_o_creat(void) { return (double)O_CREAT; }
double nts_fs_o_excl(void) { return (double)O_EXCL; }
double nts_fs_o_trunc(void) { return (double)O_TRUNC; }
double nts_fs_o_append(void) { return (double)O_APPEND; }
double nts_fs_o_sync(void) { return (double)O_SYNC; }
bool nts_fs_binding_warns_on_mkdtemp(void) { return false; }
bool nts_fs_is_32_bit(void) { return sizeof(void *) == 4; }
double nts_fs_eisdir(void) { return (double)UV_EISDIR; }

/* ------------------------------------------------------------------ stat */

/* `uv_stat_t` as fourteen doubles, in the order `Stats` reads them. One
 * binding answers `stat`, `lstat` and `fstat`: the difference is which libuv
 * call fills the buffer, not what comes back. */
static NtsArray *stat_columns(const uv_stat_t *st) {
  NtsArray *a = nts_array_new(&nts_desc_double, 14);
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
  NtsArray *values = nts_array_new(&nts_desc_double, 8);
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
  char *data = malloc(size > 0 ? size : 1);
  if (data == NULL) {
    nts_node_set_errno(UV_ENOMEM);
    return nts_array_new(&nts_desc_double, 0);
  }

  uv_buf_t buffer = uv_buf_init(data, (unsigned int)size);
  uv_fs_t request;
  int result = uv_fs_read(NULL, &request, (uv_file)fd, &buffer, 1, position,
                          NULL);
  uv_fs_req_cleanup(&request);
  nts_node_set_errno(result);

  size_t count = result < 0 ? 0 : (size_t)result;
  NtsArray *bytes = nts_array_new(&nts_desc_double, (double)count);
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
  NtsArray *bytes = nts_array_new(&nts_desc_double, (double)bytes_read);
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

double nts_fs_lutimes(NtsString *path, double atime, double mtime) {
  char *p = native_path(path);
  if (p == NULL) return (double)UV_ENOMEM;
  uv_fs_t request;
  int result = uv_fs_lutime(NULL, &request, p, atime, mtime, NULL);
  free(p);
  uv_fs_req_cleanup(&request);
  return simple(result);
}

static int close_descriptor(uv_file descriptor) {
  uv_fs_t request;
  int result = uv_fs_close(NULL, &request, descriptor, NULL);
  uv_fs_req_cleanup(&request);
  return result;
}

static char *read_entire_descriptor(uv_file descriptor, size_t *length,
                                    int *error_out) {
  uv_fs_t request;
  size_t capacity = 65536;
  size_t used = 0;
  char *data = malloc(capacity);
  int error = data == NULL ? UV_ENOMEM : 0;

  while (error == 0) {
    if (used == capacity) {
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
                                   size_t length, bool flush) {
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

  if (error == 0 && flush) {
    error = uv_fs_fsync(NULL, &request, descriptor, NULL);
    uv_fs_req_cleanup(&request);
  }
  return error;
}

static double write_entire_file(NtsString *path, const char *data,
                                size_t length, double flags, double mode,
                                bool flush) {
  char *p = native_path(path);
  if (p == NULL) return (double)UV_ENOMEM;

  uv_fs_t request;
  int descriptor =
      uv_fs_open(NULL, &request, p, (int)flags, (int)mode, NULL);
  uv_fs_req_cleanup(&request);
  free(p);
  if (descriptor < 0) return simple(descriptor);

  int error = write_entire_descriptor(descriptor, data, length, flush);
  int close_error = close_descriptor(descriptor);
  if (error == 0 && close_error < 0) error = close_error;
  return simple(error);
}

double nts_fs_write_file_utf8(NtsString *path, NtsString *contents,
                              double flags, double mode, bool flush) {
  size_t length = 0;
  char *data = nts_node_to_utf8_alloc(contents, &length);
  if (data == NULL) return simple(UV_ENOMEM);
  double result = write_entire_file(path, data, length, flags, mode, flush);
  free(data);
  return result;
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
    NtsArray *row = nts_array_new(&nts_desc_double, (double)(name_length + 1));
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

double nts_fs_unlink(NtsString *path) {
  char *p = native_path(path);
  if (p == NULL) return (double)UV_ENOMEM;
  uv_fs_t req;
  double r = simple(uv_fs_unlink(NULL, &req, p, NULL));
  free(p);
  uv_fs_req_cleanup(&req);
  return r;
}

double nts_fs_mkdir(NtsString *path, double mode) {
  char *p = native_path(path);
  if (p == NULL) return (double)UV_ENOMEM;
  uv_fs_t req;
  double r = simple(uv_fs_mkdir(NULL, &req, p, (int)mode, NULL));
  free(p);
  uv_fs_req_cleanup(&req);
  return r;
}

double nts_fs_rmdir(NtsString *path) {
  char *p = native_path(path);
  if (p == NULL) return (double)UV_ENOMEM;
  uv_fs_t req;
  double r = simple(uv_fs_rmdir(NULL, &req, p, NULL));
  free(p);
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
  uv_fs_t req;
  double r = simple(uv_fs_rename(NULL, &req, a, b, NULL));
  free(a);
  free(b);
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
  uv_fs_t req;
  double r = simple(uv_fs_copyfile(NULL, &req, a, b, (int)flags, NULL));
  free(a);
  free(b);
  uv_fs_req_cleanup(&req);
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

double nts_fs_chmod(NtsString *path, double mode) {
  char *p = native_path(path);
  if (p == NULL) return (double)UV_ENOMEM;
  uv_fs_t req;
  double r = simple(uv_fs_chmod(NULL, &req, p, (int)mode, NULL));
  free(p);
  uv_fs_req_cleanup(&req);
  return r;
}

double nts_fs_chown(NtsString *path, double uid, double gid) {
  char *p = native_path(path);
  if (p == NULL) return (double)UV_ENOMEM;
  uv_fs_t req;
  double r =
      simple(uv_fs_chown(NULL, &req, p, (uv_uid_t)uid, (uv_gid_t)gid, NULL));
  free(p);
  uv_fs_req_cleanup(&req);
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

double nts_fs_utimes(NtsString *path, double atime, double mtime) {
  char *p = native_path(path);
  if (p == NULL) return (double)UV_ENOMEM;
  uv_fs_t req;
  double r = simple(uv_fs_utime(NULL, &req, p, atime, mtime, NULL));
  free(p);
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
  uv_fs_t req;
  double r = simple(uv_fs_link(NULL, &req, a, b, NULL));
  free(a);
  free(b);
  uv_fs_req_cleanup(&req);
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

NtsArray *nts_fs_read_file_bytes_fd(double fd) {
  size_t length = 0;
  int error = 0;
  char *data = read_entire_descriptor((uv_file)fd, &length, &error);
  nts_node_set_errno(error);
  if (data == NULL) return empty_doubles();

  NtsArray *out = nts_array_new(&nts_desc_double, (double)length);
  for (size_t i = 0; i < length; i++) {
    NTS_ITEMS(out, double)[i] = (double)(unsigned char)data[i];
  }
  free(data);
  return out;
}

/* Write raw bytes. `writeFileSync` takes a string or a `Buffer`, and encoding a
 * `Buffer` into a string to pass it here would re-encode every byte above
 * 0x7f. Two bindings, one per kind of payload. */
double nts_fs_write_file_bytes(NtsString *path, NtsArray *bytes, double flags,
                               double mode, bool flush) {
  size_t length = (size_t)bytes->header.length;
  unsigned char *data = malloc(length > 0 ? length : 1);
  if (data == NULL) return simple(UV_ENOMEM);
  for (size_t i = 0; i < length; i++) {
    data[i] = (unsigned char)NTS_ITEMS(bytes, double)[i];
  }
  double result = write_entire_file(path, (const char *)data, length, flags,
                                    mode, flush);
  free(data);
  return result;
}

double nts_fs_write_file_bytes_fd(double fd, NtsArray *bytes, bool flush) {
  size_t length = (size_t)bytes->header.length;
  unsigned char *data = malloc(length > 0 ? length : 1);
  if (data == NULL) return simple(UV_ENOMEM);
  for (size_t i = 0; i < length; i++) {
    data[i] = (unsigned char)NTS_ITEMS(bytes, double)[i];
  }
  int error = write_entire_descriptor((uv_file)fd, (const char *)data,
                                      length, flush);
  free(data);
  return simple(error);
}
