// The backend runs as JavaScript. Validate its sources without starting the app.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const excluded = new Set([
    'node_modules',
    'tests',
    'dist',
    'db',
    'uploads',
    'certs',
    'coverage',
]);
let count = 0;
function check(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory() && !excluded.has(entry.name)) check(file);
        if (entry.isFile() && /\.(?:js|cjs)$/.test(entry.name)) {
            const result = spawnSync(process.execPath, ['--check', file], {
                encoding: 'utf8',
            });
            if (result.status !== 0) {
                process.stderr.write(
                    result.stderr || `Could not check ${file}\n`
                );
                process.exit(1);
            }
            count++;
        }
    }
}
check(path.join(__dirname, '..', 'backend'));
console.log(`Backend syntax check passed: ${count} JavaScript files.`);
