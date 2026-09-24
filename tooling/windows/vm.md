# The Windows lane's Windows

This box is Linux. nts compiles and links Windows artifacts here, and a Windows
machine only *runs* them. Until there is real hardware, that machine is a
quickemu Windows 11 VM.

**What the VM cannot answer.** It is x86_64. arm64 PE is built and linked here,
and its headers and imports are checked, but it is not *run* until an arm64
Windows machine is reachable.

## One-time setup

1. Create and start the VM:

   ```sh
   mkdir -p ~/vms && cd ~/vms
   quickget windows 11
   quickemu --vm windows-11.conf
   ```

   quickemu forwards ssh from a host port to the guest's 22 and prints the port
   when it boots. It is 22220 unless another VM already holds that, which is the
   Apple lane's Mac on this box.

2. In the guest, in an **administrator** PowerShell:

   ```powershell
   Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
   Start-Service sshd
   Set-Service -Name sshd -StartupType Automatic
   ```

   Then turn on automatic sign-in for your user (`netplwiz`). A GUI program
   launched over ssh runs in a session with no desktop, so W1 onwards starts
   windows through a scheduled task in the signed-in session.

3. Key authentication. For an administrator account, Windows reads
   `C:\ProgramData\ssh\administrators_authorized_keys`, not `~\.ssh`:

   ```powershell
   # paste this box's ~/.ssh/id_ed25519.pub into the file, then:
   icacls C:\ProgramData\ssh\administrators_authorized_keys /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F"
   ```

4. On this box, in `~/.ssh/config`, with the port quickemu printed:

   ```
   Host nts-win
     HostName localhost
     Port 22221
     User <your Windows user>
   ```

   `tooling/windows/run.sh --reachable` exits 0 once it answers.

## Using it

- `tooling/windows/run.sh <artifact.exe> [args...]` copies the artifact over,
  runs it, and returns its output and status. Exit 77 means no Windows was
  reachable. Examples print SKIP for that, and their other arms still count.
- The compiler never runs on Windows. nothing here needs Visual Studio, the
  Windows SDK or a Windows toolchain: the mingw headers and import libraries
  come from zig on this box.
