#!/usr/bin/env bash
# Runs a PE artifact built here on the lane's Windows machine (the quickemu VM,
# or real hardware later), and returns its stdout, stderr and exit status.
#
#   tooling/windows/run.sh <artifact.exe> [args...]
#   tooling/windows/run.sh --interactive <artifact.exe> [args...]
#   tooling/windows/run.sh --reachable      # exit 0 if Windows answers, else 77
#
# `--interactive` runs it in the signed-in user's session instead of ssh's,
# through a scheduled task (`schtasks /it`): a program that composes a window
# -- WinUI, anything on DWM -- fails fast in session 0, which has no desktop to
# compose onto (XAML ends with 0xC000027B before its first callback). Its
# stdout and stderr come back from files, and it is given 120 seconds.
#
# Every DLL beside the artifact goes with it: the Windows App SDK's
# bootstrapper is loaded from the program's own directory.
#
# NTS_WINDOWS_SSH names the ssh destination (default `nts-win`, an alias in
# ~/.ssh/config; vm.md has the stanza). Exit 77 means "no Windows reachable",
# which is not a failure of the artifact: callers print SKIP for it. Every
# other status is the artifact's own.
#
# Windows' OpenSSH server runs a command through `cmd.exe`, so the remote half
# is cmd's syntax, not a POSIX shell's. The compiler never runs on Windows; only
# the artifact crosses.
set -uo pipefail

dest="${NTS_WINDOWS_SSH:-nts-win}"
# `LogLevel=ERROR`: Windows' OpenSSH offers no post-quantum key exchange, and
# the client's warning about it on every connection would land in the
# artifact's stderr, which callers compare.
ssh_opts=(-o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new -o LogLevel=ERROR)

reachable() { ssh "${ssh_opts[@]}" "$dest" exit 0 >/dev/null 2>&1; }

if [[ "${1:-}" == "--reachable" ]]; then
  reachable && exit 0 || exit 77
fi
interactive=0
if [[ "${1:-}" == "--interactive" ]]; then
  interactive=1
  shift
fi
[[ $# -ge 1 ]] || { echo "usage: $0 <artifact.exe> [args...]" >&2; exit 2; }
artifact="$1"; shift
# Asserted before anything else: scp of a missing path and a failed run read
# as one failure otherwise.
[[ -f "$artifact" ]] || { echo "no artifact at $artifact" >&2; exit 2; }
reachable || { echo "no Windows reachable at $dest" >&2; exit 77; }

# A directory per run under the remote user's home, which is where a command
# over ssh starts. Named here because cmd has no `mktemp`.
remote="nts-run\\$(date +%s)-$$"
ssh "${ssh_opts[@]}" "$dest" "mkdir $remote" >/dev/null || exit 77
trap 'ssh "${ssh_opts[@]}" "$dest" "rmdir /s /q $remote" >/dev/null 2>&1' EXIT
# Copied as `<name>.exe` whatever it is called here: cmd runs only a file with
# an executable extension, and a consumer linked with `-o caller` has none.
name=$(basename "$artifact")
[[ "$name" == *.exe ]] || name="$name.exe"
scp -q "${ssh_opts[@]}" "$artifact" "$dest:${remote//\\//}/$name" || { echo "copying $artifact failed" >&2; exit 2; }
shopt -s nullglob
for dll in "$(dirname "$artifact")"/*.dll; do
  scp -q "${ssh_opts[@]}" "$dll" "$dest:${remote//\\//}/$(basename "$dll")" || { echo "copying $dll failed" >&2; exit 2; }
done
# cmd quoting: each argument in double quotes, with no argument at all when
# there are none (a program given one empty argument it was never passed is a
# different program -- the Apple lane's `run.sh` found that).
quoted=""
for arg in "$@"; do quoted="$quoted \"${arg//\"/\\\"}\""; done
if [[ $interactive == 0 ]]; then
  ssh "${ssh_opts[@]}" "$dest" "cd $remote && .\\$name$quoted"
  exit
fi
# One interactive program at a time, whichever session or gate starts it:
# they share one desktop, and two windows take focus from each other -- a
# program that asserts it was focused, laid out or pressed then fails for a
# reason nothing in it explains. Held on this machine, where every run is
# started, until the program has ended.
exec {desktop}>"${NTS_WINDOWS_ROOT:-$HOME/.cache/nts/windows}/interactive.lock"
flock "$desktop"
# The task runs a script beside the program, which records the status last,
# so its presence says the program has ended.
task="nts-run-$$"
script=$(mktemp)
printf 'cd /d "%%USERPROFILE%%\\%s"\r\n.\\%s%s > stdout.txt 2> stderr.txt\r\necho %%ERRORLEVEL%% > status.txt\r\n' "$remote" "$name" "$quoted" >"$script"
scp -q "${ssh_opts[@]}" "$script" "$dest:${remote//\\//}/run.cmd" || { rm -f "$script"; echo "copying the task script failed" >&2; exit 2; }
rm -f "$script"
ssh "${ssh_opts[@]}" "$dest" "schtasks /create /f /tn $task /sc once /st 23:59 /it /tr \"%USERPROFILE%\\$remote\\run.cmd\" >nul && schtasks /run /tn $task >nul" ||
  { echo "scheduling the interactive run failed" >&2; exit 2; }
status=""
for _ in $(seq 120); do
  sleep 1
  status=$(ssh "${ssh_opts[@]}" "$dest" "type $remote\\status.txt 2>nul" | tr -d '\r ') && [[ -n "$status" ]] && break
done
# A program still running after the wait is ended with its task.
ssh "${ssh_opts[@]}" "$dest" "schtasks /end /tn $task >nul 2>nul & schtasks /delete /f /tn $task >nul" >/dev/null 2>&1
ssh "${ssh_opts[@]}" "$dest" "type $remote\\stdout.txt 2>nul"
ssh "${ssh_opts[@]}" "$dest" "type $remote\\stderr.txt 2>nul" >&2
[[ -n "$status" ]] || { echo "the interactive run did not finish in 120 seconds" >&2; exit 124; }
# cmd reports the status as a signed 32-bit number; the low byte is what a
# POSIX exit status keeps, as ssh's does.
exit $(( status & 255 ))
