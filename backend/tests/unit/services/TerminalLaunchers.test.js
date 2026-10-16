const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const scripts = path.resolve(__dirname, '../../../../scripts/terminal');
const id = '12345678-1234-1234-1234-123456789abc';
let dir, env;
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-launcher-'));
    env = {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        TERMINAL_STATE_DIR: path.join(dir, 'state'),
        TERMINAL_WORKDIR: dir,
        TERMINAL_TEST_CALLS: path.join(dir, 'calls'),
        CLAUDE_CONFIG_DIR: path.join(dir, 'claude-config'),
        TERMINAL_CODEX_SESSION_ID: '',
        TERMINAL_SESSION: 'workspace',
    };
    for (const [name, source] of Object.entries({
        sleep: '#!/bin/bash\nexit 1\n',
        tmux: '#!/bin/bash\nprintf "%s\\n" "$@" > "$TERMINAL_TEST_CALLS"\n',
        claude: '#!/bin/bash\nprintf "%s\\n" "$@" >> "$TERMINAL_TEST_CALLS"\nif [[ "$1" == --session-id ]]; then mkdir -p "$CLAUDE_CONFIG_DIR/projects/test"; touch "$CLAUDE_CONFIG_DIR/projects/test/$2.jsonl"; fi\n',
        codex: '#!/bin/bash\nprintf "%s\\n" "$@" >> "$TERMINAL_TEST_CALLS"\n',
        script: `#!/bin/bash\nprintf 'codex resume ${id}\\n' > "\u0024{!#}"\n`,
    })) {
        fs.writeFileSync(path.join(dir, name), source, { mode: 0o700 });
    }
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const run = (script, cli, args = []) =>
    spawnSync('bash', [path.join(scripts, script), ...args], {
        env: { ...env, TERMINAL_CLI: cli },
        encoding: 'utf8',
        timeout: 5000,
    });
const calls = () => fs.readFileSync(env.TERMINAL_TEST_CALLS, 'utf8');
it('attaches or creates a fixed tmux session without accepting browser arguments', () => {
    expect(run('launch.sh', 'codex').status).toBe(0);
    expect(calls()).toContain('new-session\n-A\n-s\nworkspace');
    expect(calls()).toContain('TERMINAL_CLI=codex');
    expect(run('launch.sh', 'codex', ['unsafe']).status).toBe(1);
    env.TERMINAL_SESSION = '../bad';
    expect(run('launch.sh', 'codex').status).toBe(1);
});
it('reuses the same Claude UUID with --session-id first and --resume thereafter', () => {
    run('run-cli.sh', 'claude', ['workspace']);
    const saved = fs
        .readFileSync(
            path.join(env.TERMINAL_STATE_DIR, 'workspace.claude.id'),
            'utf8'
        )
        .trim();
    expect(calls()).toBe(`--session-id\n${saved}\n`);
    run('run-cli.sh', 'claude', ['workspace']);
    expect(calls()).toBe(`--session-id\n${saved}\n--resume\n${saved}\n`);
});
it('captures the first Codex resume UUID and uses an explicit id on later launches', () => {
    run('run-cli.sh', 'codex', ['workspace']);
    expect(
        fs
            .readFileSync(
                path.join(env.TERMINAL_STATE_DIR, 'workspace.codex.id'),
                'utf8'
            )
            .trim()
    ).toBe(id);
    expect(
        fs.existsSync(
            path.join(env.TERMINAL_STATE_DIR, 'workspace.codex.first-run')
        )
    ).toBe(false);
    run('run-cli.sh', 'codex', ['workspace']);
    expect(calls()).toBe(`resume\n${id}\n`);
});
it('allows seeding an existing Codex chat and refuses a corrupt saved UUID', () => {
    env.TERMINAL_CODEX_SESSION_ID = id;
    fs.mkdirSync(env.TERMINAL_STATE_DIR);
    const transcript = path.join(
        env.TERMINAL_STATE_DIR,
        'workspace.codex.first-run'
    );
    fs.writeFileSync(transcript, 'old private transcript');
    run('run-cli.sh', 'codex', ['workspace']);
    expect(calls()).toBe(`resume\n${id}\n`);
    expect(fs.existsSync(transcript)).toBe(false);
    fs.writeFileSync(
        path.join(env.TERMINAL_STATE_DIR, 'workspace.codex.id'),
        '../bad'
    );
    expect(run('run-cli.sh', 'codex', ['workspace']).status).toBe(1);
});
it('never creates another Codex chat after a first-run crash without a captured id', () => {
    fs.mkdirSync(env.TERMINAL_STATE_DIR);
    fs.writeFileSync(
        path.join(env.TERMINAL_STATE_DIR, 'workspace.codex.first-run'),
        'crashed'
    );
    const result = run('run-cli.sh', 'codex', ['workspace']);
    expect(result.stdout).toContain(
        'No new conversation will be created automatically'
    );
    expect(fs.existsSync(env.TERMINAL_TEST_CALLS)).toBe(false);
});
