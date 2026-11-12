#!/usr/bin/env bash
# token.sh --case <path> [--backend <name>] -- <command> [args...]
# token.sh --step -- <command> [args...]   a job with no case
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
#
# **A runner that is gone is an error, not a licence.** Inside a gate a runner
# that cannot be reached, or that closes the connection without `go`, has died:
# exec'ing anyway ran every waiting worker of every step at once, with nobody
# left to read their results. This exits 75 instead, naming the runner.
#
# The connection is inherited by what <command> starts, so a descendant that
# outlives it keeps the token until it exits too: it is still the step's work.
step_lease=""
if [ "${1-}" = --step ]; then
  step_lease=1; shift
  [ "${1-}" = -- ] || { echo "token.sh --step needs -- before its command" >&2; exit 2; }
  shift
elif [ "${1-}" = --case ] || [ "${1-}" = --case-last ]; then
  if [ "$1" = --case-last ]; then case_path=${!#}; shift; else case_path=${2:?token.sh --case needs a path}; shift 2; fi
  case_backend=""
  if [ "${1-}" = --backend ]; then case_backend=${2:?token.sh --backend needs a name}; shift 2; fi
  [ "${1-}" = -- ] || { echo "token.sh --case needs -- before its command" >&2; exit 2; }
  shift
  if [ -n "${NTS_GATE_TOKENS:-}" ] && [ -z "${NTS_GATE_TOKEN_HELD:-}" ]; then
    exec node "$(dirname -- "$0")/token-command.ts" --case "$case_path" --backend "$case_backend" -- "$@"
  fi
fi
if [ -z "${NTS_GATE_TOKENS:-}" ] || [ -n "${NTS_GATE_TOKEN_HELD:-}" ]; then
  exec "$@"
fi
[ -n "$step_lease" ] || { echo "token.sh: a gate request needs --case or an explicit --step lease" >&2; exit 75; }
host=${NTS_GATE_TOKENS%:*}
port=${NTS_GATE_TOKENS##*:}
if ! { exec {nts_gate_token}<>"/dev/tcp/$host/$port"; } 2>/dev/null; then
  echo "token.sh: no gate runner at $NTS_GATE_TOKENS; not running $1" >&2
  exit 75
fi
lease="step-$$-$RANDOM-$RANDOM"
# The fixed context is {"scope":"step"}, encoded once without a helper process.
printf 'want %s %s lease:%s json64:eyJzY29wZSI6InN0ZXAifQ\n' "${NTS_GATE_STEP:-?}" "$$" "$lease" >&"$nts_gate_token"
if ! IFS= read -r reply <&"$nts_gate_token" || [ "$reply" != go ]; then
  echo "token.sh: the gate runner at $NTS_GATE_TOKENS went away before granting a token; not running $1" >&2
  exit 75
fi
export NTS_GATE_TOKEN_HELD=1
export NTS_GATE_CASE_LEASE_ADDRESS="$NTS_GATE_TOKENS" NTS_GATE_CASE_LEASE_ID="$lease"
exec "$@"
