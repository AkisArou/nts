#!/bin/sh
# A C compiler for Linux on ${NTS_LINUX_ARCH:-aarch64} against musl, static,
# for `nts build` as `CC`: zig cc with the libuv `build-libuv.sh` made.
#
# Two things `CC=zig cc -target ...` alone gets wrong:
# - `-L` belongs to the link only. The witness compile runs with `-Werror`,
#   and an unused `-L` is a warning.
# - `zig cc` does not honour `-fsyntax-only`: it fails at 1:1 whatever the
#   file says. So a syntax-only check is clang's, with zig's musl headers.
arch=${NTS_LINUX_ARCH:-aarch64}
root="${NTS_LINUX_ROOT:-$HOME/.cache/nts/linux}/$arch-musl"
headers="$(zig env | sed -n 's/^ *\.lib_dir = "\(.*\)",$/\1/p')/libc/include"
for arg in "$@"; do
  if [ "$arg" = "-fsyntax-only" ]; then
    # The same arguments without `-c`, which clang reports unused beside it.
    for each in "$@"; do
      shift
      [ "$each" = "-c" ] || set -- "$@" "$each"
    done
    exec clang --target="$arch-linux-musl" -nostdlibinc -isystem "$headers/$arch-linux-musl" \
      -isystem "$headers/generic-musl" -isystem "$headers/any-linux-any" -I"$root/include" "$@"
  fi
done
for arg in "$@"; do
  case $arg in -c | -E | -S) exec zig cc -target "$arch-linux-musl" -I"$root/include" "$@" ;; esac
done
exec zig cc -target "$arch-linux-musl" -static -I"$root/include" -L"$root/lib" "$@"
