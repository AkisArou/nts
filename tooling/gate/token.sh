#!/usr/bin/env bash
# token.sh <command> [args...]: run <command> holding one of the gate's tokens.
#
# **The gate's CPU budget is a pool of tokens, one per running process**, held
# by run.mjs (see "Tokens" there). A step's workers take one each around the
# process that does the work, so the budget follows the work as it moves
# between steps instead of being split into fixed grants when each step starts
# -- `profile` once ran its whole life on the two slots it was given at second
# 125 while other steps finished and their slots stood idle.
#
# A token is a TCP connection to run.mjs, opened here and left open across the
# `exec`: it is held exactly as long as <command> runs, and the kernel closes it
# however <command> ends (SIGKILL and the OOM killer included), so a token
# cannot leak. Exit status, signals, stdin and stdout are <command>'s own:
# this script is gone once it has execed.
#
# Outside the gate (no NTS_GATE_TOKENS), or inside a process that already holds
# one (NTS_GATE_TOKEN_HELD, set here: a holder waiting for a second token while
# every token is held by such holders would deadlock), it only execs.
# A runner that cannot be reached is not a reason to fail work: it execs.
if [ -z "${NTS_GATE_TOKENS:-}" ] || [ -n "${NTS_GATE_TOKEN_HELD:-}" ]; then
  exec "$@"
fi
host=${NTS_GATE_TOKENS%:*}
port=${NTS_GATE_TOKENS##*:}
if { exec {nts_gate_token}<>"/dev/tcp/$host/$port"; } 2>/dev/null; then
  printf 'want %s %s\n' "${NTS_GATE_STEP:-?}" "$$" >&"$nts_gate_token"
  IFS= read -r _ <&"$nts_gate_token" || true
fi
export NTS_GATE_TOKEN_HELD=1
exec "$@"
