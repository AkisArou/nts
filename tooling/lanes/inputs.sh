#!/bin/sh
# Link into a worktree what no commit carries: the third-party clones, the
# native checker's upstream corpora and the workspace's node_modules.
#
#   sh tooling/lanes/inputs.sh gate <shared checkout> <tree>   what pinned.sh gates in
#   sh tooling/lanes/inputs.sh lane <shared checkout> <tree>   what `lane start` gives a lane
#
# One list for both, because a tree missing an input does not fail: it
# answers emptily. A gate step over no cases reads green, and a lane's tree
# without node_modules builds nothing a config file names. Run it again after
# any checkout; every link is re-made, never trusted.
#
set -eu

mode=$1
root=$2
tree=$3
case $mode in
  gate|lane) linked="third_party/typescript third_party/test262 third_party/are-we-fast-yet third_party/node third_party/deno" ;;
  *) echo "inputs.sh: mode is gate or lane, not $mode" >&2; exit 2 ;;
esac

# The gitignored third-party clones are inputs rather than sources -- test262,
# Are We Fast Yet, TypeScript's tests and node's `lib/`. They are not in any
# commit, so a fresh worktree has none of them; symlinked rather than copied
# because they are read-only here and total about two gigabytes.
for shared in $linked; do
  if [ -d "$root/$shared" ]; then
    # A submodule leaves an empty directory behind in the worktree; an empty
    # directory is not "not there", so remove it before linking.
    [ -d "$tree/$shared" ] && [ ! -L "$tree/$shared" ] && rmdir "$tree/$shared" 2>/dev/null || true
    # Re-pointed every run: a link made once kept pointing wherever it first
    # pointed after the shared checkout's copy moved.
    # A real directory left (a checked-out submodule) is kept: `ln` would put
    # the link inside it.
    if [ -L "$tree/$shared" ] || [ ! -e "$tree/$shared" ]; then
      mkdir -p "$(dirname "$tree/$shared")"
      ln -sfn "$root/$shared" "$tree/$shared"
    fi
  fi
done

# `node_modules` is not in any commit either, and its absence does not look
# like its absence. Three of these, and the nested ones are the ones that get
# missed -- the workspace links inside resolve by absolute path.
#
# **What needs it moved, and the old reason no longer holds.** This used to say
# `tests/programs/library` fails to *typecheck* without it, because its
# `tsconfig.json` pulled `nts.config.ts` into the program and that file imports
# `@nts/config`. It does not any more: the config is typechecked by
# `tsconfig.config.json` beside it, and the program is `src/` alone -- which was
# the fix for `nts hir` lowering the whole build-config package into a shared
# library and refusing six times inside `tooling/config/src`.
#
# The dependency is still real and is now a *config-time* one. `nts emit-c`
# evaluates `nts.config.ts` with node to read the product's `exports`, node
# resolves `@nts/config` like any dependency, and a config that exists and
# cannot be read stops the build rather than being ignored. So the copy below is
# still load-bearing; `backend_examples` would count its absence as a plain
# failure with thirty other names beside it, exactly as before.
# **The list here went stale the moment a fourth appeared.** It named three, and
# `tests/interop` then grew an `nts.config.ts` per example: the worktree could
# not resolve `@nts/config`, every interop example died with
# `ERR_MODULE_NOT_FOUND`, and the gate blamed `interop` for a change in the C
# emitter. A fixed enumeration that was complete when it was written.
#
# **Derived from the lockfile of the tree being prepared**, by
# `workspace-links.ts`: each workspace package's `link:` dependencies, made as
# the relative links pnpm makes. These were copied from the checkout this runs
# from, which holds only while the commit has its packages where the checkout
# does -- the corpora move put the library program one level deeper, at
# `tests/programs/library`, and a copied relative link then resolved outside
# the tree. Run from this script's own directory, so a pin of an older commit
# is linked by its own lockfile too.
node "$(dirname -- "$0")/workspace-links.ts" "$tree" | while IFS="$(printf '\t')" read -r link target; do
  rm -rf "${tree:?}/$link"
  mkdir -p "$(dirname "$tree/$link")"
  ln -s "$target" "$tree/$link"
done
# `benchmarks/node_modules` holds the AssemblyScript compiler the benchmark
# table's AssemblyScript column builds with: a relative link into the root's
# pnpm store, copied for the same reason as below, so it resolves through this
# tree's own root link. Without it a pinned tree measures that column as
# "not installed".
for modules in node_modules runtime/node/node_modules benchmarks/node_modules; do
  [ -d "$root/$modules" ] || continue
  # **Copied rather than linked where a workspace link lives inside it.**
  #
  # `tests/programs/library/node_modules/@nts/config` is a *relative*
  # symlink, `../../../../tooling/config`. A symlink to the whole directory
  # makes that relative path resolve from its physical location -- the main
  # tree -- so the worktree compiled `$root/tooling/config/src/*.ts`, which is
  # outside its own `rootDir`, and tsgo answered `TS6059 ... is not under
  # rootDir`. The example then failed to *typecheck*, which reads as "refuses
  # nothing" in `example-refusals` and as one more non-agreement in `llvm` and
  # `jvm` -- three symptoms, none of them naming the cause.
  #
  # `cp -a` keeps a relative link relative, so it resolves inside the tree and
  # the pin means what it says. Only the small ones: the top-level tree is 32M
  # of pnpm store with no workspace link in it and is still shared.
  case $modules in
    node_modules) ln -sfn "$root/$modules" "$tree/$modules" ;;
    *)
      rm -rf "$tree/$modules"
      mkdir -p "$(dirname "$tree/$modules")"
      cp -a "$root/$modules" "$tree/$modules"
      ;;
  esac
done

