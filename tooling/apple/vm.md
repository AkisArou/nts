# The Apple lane's Mac

This box is Linux. nts compiles and links Apple artifacts here; a Mac only
*runs* them. Until there is real hardware, the Mac is a quickemu VM.

**Licence.** Apple's macOS licence permits virtualisation only on Apple
hardware. Running this VM on a PC is the user's decision, taken knowingly on
2026-09-23; nothing in the build depends on it being a VM, and a real Mac
replaces it by changing one ssh alias.

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
   quickget macos sequoia
   quickemu --vm macos-sequoia.conf
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
