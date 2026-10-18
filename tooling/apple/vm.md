# The Apple lane's Mac

This box is Linux. nts compiles and links Apple artifacts here; a Mac only
*runs* them. Until there is real hardware, the Mac is a quickemu VM.

**Licence.** Apple's macOS licence permits virtualisation only on Apple
hardware. Running this VM on a PC is the user's decision, taken knowingly on
2026-09-23. The VM in use since 2026-09-24 is macOS 26.6 (Tahoe, the last
release for Intel) with full Xcode and the 26.5 SDK. Nothing in the build
depends on it being a VM, and a real Mac replaces it by changing one ssh alias.

**What a VM cannot answer.** The VM is x86_64. arm64 Mach-O is built and linked
here, and its load commands and symbols are checked, but it is never *run* until
an arm64 Mac is reachable. That gap matters most for `objc_msgSend`, whose
variadic-versus-typed call difference is an arm64 problem. The lane never emits
a variadic `objc_msgSend` call, so correctness does not rest on arm64 running
by luck.

## One-time setup

1. Create and start the VM (about 15 GB download, 30-60 minutes):

   ```sh
   mkdir -p ~/vms && cd ~/vms
   quickget macos tahoe
   quickemu --vm macos-tahoe.conf
   ```

   Install macOS from the recovery image the first time; quickemu's own README
   walks through the Disk Utility step. quickemu forwards ssh on host port
   22220 and prints the port when it boots.
2. In the guest:
   - System Settings → General → Sharing → **Remote Login** on.
   - System Settings → Users & Groups → **automatic login** for your user, so
     a GUI program launched over ssh reaches WindowServer (A2 onwards).
   - In Terminal: `xcode-select --install`, for the Command Line Tools:
     clang, swiftc, and the MacOSX SDK.
3. On this box, add this stanza to `~/.ssh/config`, then `ssh-copy-id nts-mac`:

   ```
   Host nts-mac
     HostName 127.0.0.1
     Port 22220
     User <your macOS user>
   ```
4. Copy the SDK back, so bindings and framework links work with the VM off:
   `tooling/apple/sync-sdk.sh`, which writes `~/.cache/nts/apple/MacOSX.sdk`.
   Then export `NTS_APPLE_SDK` to that path.

## Everyday use

| Script | What it does |
|---|---|
| `tooling/apple/zig-sdk.sh` | minimal sysroot from zig's Darwin libc: libSystem-only programs, no SDK needed |
| `tooling/apple/build-libuv.sh` | libuv for `aarch64`/`x86_64` macOS, which every nts executable links |
| `tooling/apple/run.sh <artifact>` | runs it on the Mac; exit 77 means no Mac reachable (callers print SKIP) |
| `tooling/apple/sync-sdk.sh` | copies the Command Line Tools SDK out of the VM |

## A desktop session

An application that opens a window needs a user logged in to the Mac's
desktop. After a reboot with no automatic login, the VM answers ssh from its
login window: the command-line examples run, and `macos-window` and
`macos-notes` print "not run -- the Mac has no user logged in to its desktop"
(`run.sh --gui`). Log in once through the SPICE socket,
`remote-viewer spice+unix:///$HOME/macos-tahoe/macos-tahoe.sock`, tunnelled
from another machine with `ssh -L 5930:$HOME/macos-tahoe/macos-tahoe.sock`.
Turning on automatic login (System Settings, Users & Groups) keeps a reboot
from losing the session.

## Before an Apple landing

Boot the VM before queueing, confirm `tooling/apple/run.sh --reachable` and
`--gui`, and keep it running through the Apple interop arms. For iOS, also run
`tooling/apple/run-ios.sh --reachable`: it boots the configured `NTS_IOS_DEVICE`
(default `iPhone 17`) and waits for readiness under the shared Mac lock. SSH
alone does not establish simulator readiness.

`NTS_IOS_READY_TIMEOUT` bounds that wait separately (default 600 seconds).
An unavailable Mac returns 77; a reachable Mac with a missing or broken
simulator fails by name instead of being skipped. Direct application runs
perform the same readiness check. `NTS_IOS_TIMEOUT` remains 300 seconds for
installing and running the application. Named readiness, install and attached
launch/application timings go to stderr; interop forwards them into its gate
log without adding anything to application stdout or its golden comparison.

