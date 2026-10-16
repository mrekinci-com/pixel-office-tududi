#!/usr/bin/env bash
# ttyd entry point. The browser never selects a host path or command.
set -euo pipefail
umask 077
terminal_scripts_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
terminal_key="${TERMINAL_SESSION:-terminal}"
terminal_workdir="${TERMINAL_WORKDIR:-}"
terminal_state_dir="${TERMINAL_STATE_DIR:-$HOME/.local/state/tududi-terminal}"
terminal_cli="${TERMINAL_CLI:-claude}"
if [[ $# != 0 || ! "$terminal_key" =~ ^[a-zA-Z0-9_-]{1,64}$ ]]; then
    echo 'Terminal: invalid session name or unexpected browser arguments.' >&2
    exit 1
fi
if [[ ! "$terminal_workdir" = /* || ! -d "$terminal_workdir" ]]; then
    echo 'Terminal: set TERMINAL_WORKDIR to an existing absolute host directory.' >&2
    exit 1
fi
if [[ "$terminal_cli" != claude && "$terminal_cli" != codex ]]; then
    echo 'Terminal: TERMINAL_CLI must be claude or codex.' >&2
    exit 1
fi
if [[ ! "$terminal_state_dir" = /* ]]; then
    echo 'Terminal: TERMINAL_STATE_DIR must be an absolute host directory.' >&2
    exit 1
fi
mkdir -p -- "$terminal_state_dir"
chmod 700 -- "$terminal_state_dir"
# A dedicated tmux server applies clipboard forwarding without changing any
# other tmux server. new-session -A atomically attaches or creates the session.
exec tmux -L tududi-terminal -f "$terminal_scripts_dir/tmux.conf" new-session -A \
    -s "$terminal_key" -c "$terminal_workdir" \
    -e "TERMINAL_CLI=$terminal_cli" -e "TERMINAL_STATE_DIR=$terminal_state_dir" \
    -e "TERMINAL_CODEX_SESSION_ID=${TERMINAL_CODEX_SESSION_ID:-}" \
    "$terminal_scripts_dir/run-cli.sh" "$terminal_key"
