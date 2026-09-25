#!/usr/bin/env bash
# Cross-builds libuv for macOS from the copy node vendors, into
# ${NTS_APPLE_ROOT:-~/.cache/nts/apple}/<arch>/{include,lib/libuv.a}.
#
# An nts executable links the libuv host, and a Linux box has only a Linux
# libuv. The source list is libuv's own CMakeLists for `APPLE`, spelled out
# here rather than driving cmake so the one tool this needs is `zig`.
#
# With NTS_APPLE_SDK set, it compiles against that SDK with clang. Without one,
# zig's bundled Darwin headers are enough -- including for `fsevents.c`, which
# declares the CoreFoundation/CoreServices surface itself (`darwin-stub.h`) and
# `dlopen`s the frameworks at run time, so no framework header is needed.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
uv="$repo/third_party/node/deps/uv"
root="${NTS_APPLE_ROOT:-$HOME/.cache/nts/apple}"
archs=("$@")
[[ ${#archs[@]} -gt 0 ]] || archs=(aarch64 x86_64)

[[ -f "$uv/include/uv.h" ]] || { echo "no vendored libuv at $uv" >&2; exit 1; }

sources=(
  src/fs-poll.c src/idna.c src/inet.c src/random.c src/strscpy.c src/strtok.c
  src/thread-common.c src/threadpool.c src/timer.c src/uv-common.c
  src/uv-data-getter-setters.c src/version.c
  src/unix/async.c src/unix/core.c src/unix/dl.c src/unix/fs.c
  src/unix/getaddrinfo.c src/unix/getnameinfo.c src/unix/loop-watcher.c
  src/unix/loop.c src/unix/pipe.c src/unix/poll.c src/unix/process.c
  src/unix/random-devurandom.c src/unix/signal.c src/unix/stream.c
  src/unix/tcp.c src/unix/thread.c src/unix/tty.c src/unix/udp.c
  src/unix/proctitle.c src/unix/bsd-ifaddrs.c src/unix/kqueue.c
  src/unix/random-getentropy.c
  src/unix/darwin-proctitle.c src/unix/darwin.c src/unix/fsevents.c
)
defines=(-D_FILE_OFFSET_BITS=64 -D_LARGEFILE_SOURCE -D_DARWIN_UNLIMITED_SELECT=1 -D_DARWIN_USE_64_BIT_INODE=1)

# `build_into DEST CC...`: every source compiled with CC into DEST's archive,
# and the headers beside it.
build_into() {
  local dest=$1
  shift
  local objs="$dest/obj/libuv"
  mkdir -p "$objs" "$dest/lib" "$dest/include"
  local objects=()
  for src in "${sources[@]}"; do
    local obj="$objs/$(echo "$src" | tr / _).o"
    "$@" -O2 -fno-strict-aliasing -w "${defines[@]}" \
      -I"$uv/include" -I"$uv/src" -c "$uv/$src" -o "$obj"
    objects+=("$obj")
  done
  rm -f "$dest/lib/libuv.a"
  "${ar[@]}" rcs "$dest/lib/libuv.a" "${objects[@]}"
  rm -rf "$dest/include/uv" "$dest/include/uv.h"
  cp -R "$uv/include/." "$dest/include/"
}

for arch in "${archs[@]}"; do
  # `x86_64-ios-simulator`: the iOS simulator on an Intel Mac, against the
  # SDK `tooling/apple/sync-sdk.sh iphonesimulator` copies.
  if [[ "$arch" == x86_64-ios-simulator ]]; then
    ar=(llvm-ar)
    build_into "$root/$arch" clang -target x86_64-apple-ios13.0-simulator \
      -isysroot "${NTS_IOS_SIMULATOR_SDK:-$root/iPhoneSimulator.sdk}"
    echo "libuv for the iOS simulator: $root/$arch/lib/libuv.a"
    continue
  fi
  case "$arch" in aarch64) apple=arm64 ;; x86_64) apple=x86_64 ;; *) echo "unknown arch $arch" >&2; exit 1 ;; esac
  if [[ -n "${NTS_APPLE_SDK:-}" ]]; then
    cc=(clang -target "$apple-apple-macos11" -isysroot "$NTS_APPLE_SDK")
    ar=(llvm-ar)
  else
    cc=(zig cc -target "$arch-macos")
    ar=(zig ar)
  fi
  build_into "$root/$arch" "${cc[@]}"
  echo "libuv for $arch-macos: $root/$arch/lib/libuv.a"
done
