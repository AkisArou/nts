#!/usr/bin/env bash
# Does every built addon survive `require`?
#
#   tooling/conformance/loads.sh
#   tooling/conformance/loads.sh os path
#
# **Building is not loading, and nothing between the two was checking.** The
# build floor reports "22 of 22 still build" and the addon sweep runs node's
# tests, which do load -- but the sweep takes thirty-five minutes and the floor
# takes seconds, so a crash on load lived in the gap between them.
#
# It did happen. After the index-signature representation landed, `os.node`
# segfaulted inside `nts_map_set` during `module__init`: the four
# `Record<string, number>` fields of `OsConstants` were never given a table and
# the first write went through a null pointer. Every measurement taken that hour
# was static -- refusal counts from `emit-c`, and a grep for
# `napi_set_named_property` in the emitted wrapper -- and every one of them said
# `os` published 17 names, on a pin where requiring it killed the process.
#
# This is one `require()` per artifact. It answers the smallest question that
# cannot be answered by reading emitted text, and it costs a second.
#
# A crash is reported with its signal, because exit 139 and a failed assertion
# are different findings and only one of them is about the module's behaviour.
set -uo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

# `target/node` is shared with the other sessions in this tree, so a run that
# names it reads whatever they last wrote. `NTS_ADDON_OUT` is the variable
# `build.sh` and `axis-controls.mjs` take; the default is unchanged.
#
# This check is the one that has contradicted a wrong table before -- it caught
# thirteen false `did not build` rows from a deleted pin -- so it is worth it
# being able to answer about the same artifacts the rest of a run measures.
addon_dir="${NTS_ADDON_OUT:-$root/target/node}"

# `node` may be a version-manager shim; resolve it so the signal is the child's.
node_bin="$(command -v node)"

modules=("$@")
if [ ${#modules[@]} -eq 0 ]; then
  # A module is a directory with its own tsconfig. Listing the parent instead
  # reports `README.md` and `tsconfig.json` as modules with no addon built,
  # which is three lines of noise in a check whose whole value is that its
  # output is short enough to read.
  mapfile -t modules < <(
    for d in "$root"/runtime/node/*/; do
      name="$(basename "$d")"
      [ "$name" = "node_modules" ] && continue
      [ -f "$d/tsconfig.json" ] && printf '%s\n' "$name"
    done | sort
  )
fi

# The compiler this run is asking about. The same expression `build-floor.sh`
# uses, spelled again rather than shared: these two scripts are run separately
# as often as together, and a default that lived in one of them would be a
# default the other did not have.
compiler="${NTS_COMPILER:-${NTS_BIN:-$root/target/release/nts}}"

# Whether an addon predates something it was built from, and which thing.
#
# **An artifact older than its inputs is not evidence about them.** This check
# loads whatever `.node` files are in the directory -- deliberately, so that it
# answers about the same artifacts the rest of a run measures -- and until this
# existed it could not tell "built by this compiler and loads" from "left here
# in September and still lying there".
#
# That is not hypothetical and it is not rare. `build-floor.sh` rebuilds the
# modules in `FLOOR` and nothing else, so any module *outside* the floor keeps
# whatever artifact it last had, indefinitely. On 2026-09-17 this reported
# `child_process` as loading, from a `.node` built on 2026-09-13, on a compiler
# that had never compiled it -- while the build half said `24 of 24 still
# build, 0 newly building` one screen above. A whole claim was written on the
# strength of the loading half.
#
# Reported rather than failed. A stale artifact is an unanswered question, not
# a regression, and failing on one would break this check in every working tree
# that has ever built a module -- which is every one of them. What it must not
# be is counted as `ok`, because `ok` is what the summary offers as evidence.
stale_because() {
  local addon="$1" module="$2" newer
  if [ -f "$compiler" ] && [ "$compiler" -nt "$addon" ]; then
    printf 'the compiler'
    return 0
  fi
  newer=$(find "$root/runtime/node/$module" "$root/runtime/node/internal" \
    -name '*.ts' -newer "$addon" -print -quit 2>/dev/null)
  if [ -n "$newer" ]; then
    printf '%s' "${newer#"$root"/}"
    return 0
  fi
  return 1
}

ok=0; crashed=0; absent=0; stale=0
for module in "${modules[@]}"; do
  addon="$addon_dir/$module.node"
  if [ ! -f "$addon" ]; then
    printf '  %-22s no addon built\n' "$module"
    absent=$((absent + 1))
    continue
  fi
  if because=$(stale_because "$addon" "$module"); then
    printf '  %-22s older than %s, so loading it says nothing about this compiler\n' \
      "$module" "$because"
    stale=$((stale + 1))
    continue
  fi
  # `require` binds lazily, which is not the question.
  #
  # **A wrapper naming a symbol the C backend refused does not fail the link.**
  # The addon loads, publishes the name, and dies on the *first call* with
  # `symbol lookup error: … undefined symbol: describe` -- not a JavaScript
  # exception, not catchable, at whatever later moment somebody calls it. Under
  # `require` this check would have reported `loads, 2 name(s) published` about
  # an addon with a landmine in it.
  #
  # `RTLD_NOW` resolves every symbol at load, so the landmine becomes a load
  # failure naming the symbol. Controlled on a deliberately broken shared object
  # with an `extern` never defined:
  #
  #     RTLD_LAZY: Module did not self-register        <- the defect is invisible
  #     RTLD_NOW:  undefined symbol: refused_body      <- named
  # Both counts, because the raw one has been read as progress and is not.
  #
  # `Object.keys(addon)` counts whatever the export table contains, and it
  # contains more than node's surface: `async_hooks` publishes sixteen and
  # **three** are node's; `readline` publishes seven and **none** is.
  #
  # **Those extra names are deliberate and the addon is not wrong.**
  # `async_hooks/src/main.ts:38` re-exports its thirteen as "raw implementation
  # exports for the conformance harness's node-internal facade", which
  # `shape.mjs` omits from the public object -- so the addon publishes what its
  # entry exports and the shim narrows to node's. Both layers are correct.
  #
  # **Zero names is its own sentence.** With no exports, `shared === ours.length`
  # is `0 === 0` and the line read `loads, 0 name(s) published (all of them
  # node's)` -- a vacuous truth in the shape of a positive finding, printed for
  # six of the seven modules that have nothing on the compiled axis. Nothing was
  # wrong with the count; the parenthetical was answering a question that does
  # not arise.
  #
  # What is wrong is reporting one number for two things. `os` 17 and `path` 15
  # are entirely node's; `async_hooks` 16 is three of node's and thirteen of the
  # harness's, and as a single figure they read the same. No surface test
  # separates them either -- each runs against what `shape.mjs` returns, which is
  # node's key set by construction.
  out="$("$node_bin" -e "
    const flags = require('node:os').constants.dlopen;
    const m = { exports: {} };
    process.dlopen(m, '$addon', flags.RTLD_NOW);
    const ours = Object.keys(m.exports).filter((k) => m.exports[k] !== undefined);
    let theirs = null;
    try { theirs = new Set(Object.keys(require('node:$module'))); } catch { /* no such node module */ }
    const shared = theirs === null ? null : ours.filter((k) => theirs.has(k)).length;
    console.log(ours.length === 0
      ? 'loads, and publishes nothing'
      : 'loads, ' + ours.length + ' name(s) published' +
      (shared === null ? ' (node has no such module to compare)'
       : shared === ours.length ? ' (all of them node\\'s)'
       : ' (' + shared + ' of them node\\'s)'))" 2>&1)"
  status=$?
  if [ $status -eq 0 ]; then
    printf '  %-22s %s\n' "$module" "$out"
    ok=$((ok + 1))
  else
    # 128+n is a signal; 139 is SIGSEGV, which is the one this exists for.
    if [ $status -gt 128 ]; then
      reason="CRASHED on require, signal $((status - 128))"
    else
      # The useful line is the thrown message, not the first line of node's
      # stack trace. `undefined symbol: X` is the whole finding for the class
      # this check exists for, and `head -1` reported `[eval]:4` instead.
      detail="$(printf '%s' "$out" | grep -oE 'undefined symbol: [A-Za-z_][A-Za-z0-9_]*' | head -1)"
      [ -z "$detail" ] && detail="$(printf '%s' "$out" | grep -E '^[A-Za-z]*Error: ' | head -1)"
      [ -z "$detail" ] && detail="$(printf '%s' "$out" | head -1)"
      reason="failed to load (exit $status): $(printf '%s' "$detail" | cut -c1-72)"
    fi
    printf '  %-22s %s\n' "$module" "$reason"
    crashed=$((crashed + 1))
  fi
done

printf '\n%d load, %d crashed or failed, %d not built' "$ok" "$crashed" "$absent"
[ "$stale" -gt 0 ] && printf ', %d older than what built them' "$stale"
printf '\n'
[ "$crashed" -eq 0 ]
