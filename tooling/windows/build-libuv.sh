#!/usr/bin/env bash
# Cross-builds libuv for Windows (MinGW ABI) from the copy node vendors, into
# ${NTS_WINDOWS_ROOT:-~/.cache/nts/windows}/<arch>/{include,lib/libuv.a}.
#
# An nts executable links the libuv host, and a Linux box has only a Linux
# libuv. The source list is libuv's own CMakeLists for `WIN32`, spelled out
# here rather than driving cmake so the one tool this needs is `zig`, whose
# bundled mingw-w64 supplies the headers and import libraries.
#
# A program linking the result also needs libuv's system libraries, which
# `nts build` adds for a Windows target: WINDOWS_UV_LIBS below is the list.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
uv="$repo/third_party/node/deps/uv"
root="${NTS_WINDOWS_ROOT:-$HOME/.cache/nts/windows}"
archs=("$@")
[[ ${#archs[@]} -gt 0 ]] || archs=(x86_64 aarch64)

[[ -f "$uv/include/uv.h" ]] || { echo "no vendored libuv at $uv" >&2; exit 1; }

sources=(
  src/fs-poll.c src/idna.c src/inet.c src/random.c src/strscpy.c src/strtok.c
  src/thread-common.c src/threadpool.c src/timer.c src/uv-common.c
  src/uv-data-getter-setters.c src/version.c
  src/win/async.c src/win/core.c src/win/detect-wakeup.c src/win/dl.c
  src/win/error.c src/win/fs.c src/win/fs-event.c src/win/getaddrinfo.c
  src/win/getnameinfo.c src/win/handle.c src/win/loop-watcher.c src/win/pipe.c
  src/win/thread.c src/win/poll.c src/win/process.c src/win/process-stdio.c
  src/win/signal.c src/win/snprintf.c src/win/stream.c src/win/tcp.c
  src/win/tty.c src/win/udp.c src/win/util.c src/win/winapi.c src/win/winsock.c
)
defines=(-DWIN32_LEAN_AND_MEAN -D_WIN32_WINNT=0x0A00 -D_CRT_DECLARE_NONSTDC_NAMES=0)

for arch in "${archs[@]}"; do
  case "$arch" in aarch64 | x86_64) ;; *) echo "unknown arch $arch" >&2; exit 1 ;; esac
  cc=(zig cc -target "$arch-windows-gnu")
  dest="$root/$arch"
  objs="$dest/obj/libuv"
  mkdir -p "$objs" "$dest/lib" "$dest/include"
  objects=()
  for src in "${sources[@]}"; do
    obj="$objs/$(echo "$src" | tr / _).o"
    "${cc[@]}" -O2 -fno-strict-aliasing -w "${defines[@]}" \
      -I"$uv/include" -I"$uv/src" -c "$uv/$src" -o "$obj"
    objects+=("$obj")
  done
  rm -f "$dest/lib/libuv.a"
  zig ar rcs "$dest/lib/libuv.a" "${objects[@]}"
  rm -rf "$dest/include/uv" "$dest/include/uv.h"
  command cp -R "$uv/include/." "$dest/include/"
  echo "libuv for $arch-windows-gnu: $dest/lib/libuv.a"
done
