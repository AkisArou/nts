#!/bin/sh
# Build a program using GJS's `gettext` module (runtime/gtk/gettext.ts) as a
# C and an LLVM product, run each plain and under reference counting with a
# catalogue compiled from po/eo.po, and check the translations (see
# src/main.ts). The control: the same binary with no catalogue bound answers
# each msgid, so a pass is a translation and not an echo.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
out=${1:-"$root/target/interop-gtk-gettext"}
nts=${NTS_BIN:-"$root/target/release/nts"}
source="$root/examples/interop/gtk-gettext"

if ! pkg-config --exists glib-2.0; then
  echo "SKIP gtk-gettext: no glib-2.0 pkg-config entry"
  exit 0
fi
if [ ! -e /usr/share/gir-1.0/GLib-2.0.gir ] && [ -z "${GI_GIR_PATH:-}" ]; then
  echo "SKIP gtk-gettext: no GLib-2.0.gir"
  exit 0
fi
if ! command -v msgfmt >/dev/null 2>&1; then
  echo "SKIP gtk-gettext: no msgfmt on PATH"
  exit 0
fi
# glibc reads LANGUAGE only in a locale other than C, so a real one.
if ! locale -a 2>/dev/null | grep -qi '^en_US\.utf-\?8$'; then
  echo "SKIP gtk-gettext: no en_US.UTF-8 locale"
  exit 0
fi

mkdir -p "$out/locale/eo/LC_MESSAGES"
msgfmt -o "$out/locale/eo/LC_MESSAGES/nts-gettext.mo" "$source/po/eo.po"
expected="Saluton pomo pomoj Malfermi Saluton Untranslated"
untranslated="Hello apple apples Open Hello Untranslated"
for mode in plain rc; do
  flag=""
  [ "$mode" = rc ] && flag="--rc"
  # shellcheck disable=SC2086
  "$nts" build "$source/tsconfig.json" --out "$out/$mode" $flag
  for product in gettext gettext-llvm; do
    binary="$out/$mode/$product/linux-gnu-x86_64/$product"
    log=$(env LC_ALL= LANG=en_US.UTF-8 LANGUAGE=eo NTS_GETTEXT_LOCALE="$out/locale" timeout 30 "$binary")
    bare=$(env LC_ALL= LANG=en_US.UTF-8 LANGUAGE=eo NTS_GETTEXT_LOCALE="$out/none" timeout 30 "$binary")
    echo "$product ($mode): $log"
    if [ "$log" != "$expected" ] || [ "$bare" != "$untranslated" ]; then
      echo "FAILED gtk-gettext: $product ($mode) expected $expected, and without a catalogue $untranslated; got $bare" >&2
      exit 1
    fi
  done
done
echo "GJS's gettext module, on C and LLVM: OK"
