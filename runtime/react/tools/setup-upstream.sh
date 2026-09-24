#!/bin/sh
# Prepare the pinned upstream React checkout that the conformance harness runs
# in: a private clone (your own React checkout is only read), its dependencies,
# and upstream's own stable build, which is the control arm.
#
#   runtime/react/tools/setup-upstream.sh
#
# NTS_REACT_SOURCE  the React repository to clone from (default ~/Projects/react)
# NTS_REACT_UPSTREAM where the clone goes (default ~/.cache/nts-react/upstream)
set -eu

lane=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
commit=$(node -p "require('$lane/upstream-compile/upstream.lock.json').commit")
source=${NTS_REACT_SOURCE:-$HOME/Projects/react}
dest=${NTS_REACT_UPSTREAM:-$HOME/.cache/nts-react/upstream}

[ -d "$dest/.git" ] || git clone -q --shared --no-checkout "$source" "$dest"
git -C "$dest" -c advice.detachedHead=false checkout -q "$commit"
cd "$dest"

[ -d node_modules ] || yarn install --frozen-lockfile --ignore-engines --network-timeout 600000

# Upstream's `build.js` matches a requested name against each bundle's entry
# path, so the trailing slash matters: `react` would also match
# `eslint-plugin-react-hooks` and every other package with "react" in it.
# react-dom, react-server and react-client are built only so the control arm
# can run the test files that require them; this lane does not implement them.
rm -rf build
RELEASE_CHANNEL=stable node ./scripts/rollup/build.js \
  react/,scheduler/,react-reconciler/,react-noop-renderer/,jest-react/,use-sync-external-store/,react-test-renderer/,react-is/,react-dom/,react-server/,react-client/ \
  --type=NODE_DEV,NODE_PROD --release-channel=stable
# `build.js` writes build/node_modules; upstream's release-channel script is
# what renames it, and config.build.js reads build/oss-stable.
mv build/node_modules build/oss-stable
echo "upstream ready at $dest ($commit)"
