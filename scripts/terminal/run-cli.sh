#!/usr/bin/env bash
# One conversation per tmux key and CLI, persisted outside the repository.
# Requires bash, python3 and (for the first Codex chat) util-linux script.
set -euo pipefail
umask 077
terminal_key="${1:-}"
terminal_cli="${TERMINAL_CLI:-claude}"
terminal_state_dir="${TERMINAL_STATE_DIR:-$HOME/.local/state/tududi-terminal}"
if [[ ! "$terminal_key" =~ ^[a-zA-Z0-9_-]{1,64}$ || ! "$terminal_state_dir" = /* ]]; then
    echo 'Terminal: invalid session key or state directory.' >&2
    exit 1
fi
if [[ "$terminal_cli" != claude && "$terminal_cli" != codex ]]; then
    echo 'Terminal: TERMINAL_CLI must be claude or codex.' >&2
    exit 1
fi
mkdir -p -- "$terminal_state_dir"
chmod 700 -- "$terminal_state_dir"
terminal_id_file="$terminal_state_dir/$terminal_key.$terminal_cli.id"
terminal_id=''
terminal_uuid_pattern='^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
save_id() {
    if [[ ! "$1" =~ $terminal_uuid_pattern ]]; then
        echo 'Terminal: expected a conversation UUID.' >&2
        return 1
    fi
    printf '%s\n' "$1" > "$terminal_id_file.tmp"
    mv -- "$terminal_id_file.tmp" "$terminal_id_file"
    terminal_id="$1"
}
if [[ -s "$terminal_id_file" ]]; then
    terminal_id="$(cat -- "$terminal_id_file")"
    if [[ ! "$terminal_id" =~ $terminal_uuid_pattern ]]; then
        echo 'Terminal: invalid saved conversation UUID; repair the state file.' >&2
        exit 1
    fi
fi
if [[ "$terminal_cli" == claude && -z "$terminal_id" ]]; then
    save_id "$(python3 -c 'import uuid; print(uuid.uuid4())')"
elif [[ "$terminal_cli" == codex && -z "$terminal_id" && -n "${TERMINAL_CODEX_SESSION_ID:-}" ]]; then
    save_id "$TERMINAL_CODEX_SESSION_ID"
fi
# Also remove a leftover transcript when recovering via an existing/seeded ID.
if [[ "$terminal_cli" == codex && -n "$terminal_id" ]]; then
    rm -f -- "$terminal_state_dir/$terminal_key.codex.first-run"
fi
# Ctrl+C stops the launcher instead of starting an unbounded restart loop.
trap 'exit 0' INT TERM
while true; do
    if [[ "$terminal_cli" == claude ]]; then
        terminal_claude_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
        if compgen -G "$terminal_claude_dir/projects/*/$terminal_id.jsonl" > /dev/null; then
            claude --resume "$terminal_id" || true
        else
            claude --session-id "$terminal_id" || true
        fi
    elif [[ -n "$terminal_id" ]]; then
        codex resume "$terminal_id" || true
    else
        terminal_transcript="$terminal_state_dir/$terminal_key.codex.first-run"
        # Codex has no --session-id for new interactive sessions. Capture its
        # exit-time 'codex resume <UUID>' instruction once, never use --last
        # (which could select an unrelated conversation on this host).
        if [[ ! -e "$terminal_transcript" ]]; then
            command -v script > /dev/null
            script -q -e -f -c 'codex --no-alt-screen' "$terminal_transcript" || true
        fi
        terminal_id="$(python3 - "$terminal_transcript" <<'PY'
import re
import sys
from pathlib import Path
text = Path(sys.argv[1]).read_text(errors='replace')
text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text)
ids = re.findall(r'codex resume ([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})(?![a-fA-F0-9-])', text)
print(ids[-1] if ids else '')
PY
)"
        if [[ -z "$terminal_id" ]]; then
            echo 'Terminal: first Codex chat did not print a resume UUID (it may have crashed).'
            echo 'Find that chat with codex resume on the host, use /status, then paste its UUID here.'
            echo 'No new conversation will be created automatically.'
            read -r -p 'Conversation UUID: ' terminal_id
        fi
        save_id "$terminal_id"
        # The temporary transcript may contain chat content. Remove it as soon
        # as the UUID is safely persisted; state and credentials stay on host.
        rm -f -- "$terminal_transcript"
    fi
    printf '\nTerminal: CLI exited; resuming the same conversation in 3 seconds (Ctrl+C stops).\n'
    sleep 3
done
