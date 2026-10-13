"""Where the generator's inputs that no commit carries are.

The same rule as tooling/chromium/checkout.ts: in a lane's worktree Chromium's
source and typescript-go (both submodules) are empty directories, and the one
real copy of each is in the checkout every worktree shares. NTS_CHROMIUM_SRC
overrides Chromium's source directory.
"""

import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

# git's common directory is the shared checkout's `.git`, from the checkout
# itself or from any worktree.
SHARED = os.path.dirname(subprocess.run(
    ["git", "-C", ROOT, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    check=True, capture_output=True, text=True).stdout.strip())

CHROMIUM_SRC = os.path.abspath(os.environ.get("NTS_CHROMIUM_SRC")
                               or os.path.join(SHARED, "third_party", "chromium", "src"))
TYPESCRIPT_GO = os.path.join(SHARED, "third_party", "typescript-go")
