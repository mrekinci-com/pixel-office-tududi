const express = require('express');
const multer = require('multer');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Project } = require('../models');
const { requireTerminalSession } = require('../services/TerminalProxy');
const {
    getUploadConfig,
    getApplicationBasePath,
} = require('../services/TerminalConfig');
const router = express.Router();
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
// One byte over the limit so an image of exactly 15 MB is accepted and the
// size is checked explicitly below.
const receiveImage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES + 1, files: 1, fields: 0 },
}).single('image');
const uploadNamePattern = /^\d{8}-\d{6}-[a-f0-9]{8}\.(png|jpg|gif|webp)$/;

function imageExtension(bytes) {
    if (
        bytes.length >= 8 &&
        bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    ) {
        return 'png';
    }
    if (
        bytes.length >= 3 &&
        bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
    ) {
        return 'jpg';
    }
    if (
        bytes.length >= 6 &&
        ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('latin1'))
    ) {
        return 'gif';
    }
    if (
        bytes.length >= 12 &&
        bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
        bytes.subarray(8, 12).toString('latin1') === 'WEBP'
    ) {
        return 'webp';
    }
    return null;
}

async function pruneUploads(dir) {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isFile() || !uploadNamePattern.test(entry.name)) continue;
        const file = path.join(dir, entry.name);
        try {
            const stat = await fs.lstat(file);
            if (stat.isFile() && stat.mtimeMs < cutoff) await fs.unlink(file);
        } catch (error) {
            // Concurrent uploads can already have removed this expired file.
            if (error.code !== 'ENOENT') throw error;
        }
    }
}

router.use('/terminal', requireTerminalSession);

router.get('/terminal/config', async (req, res, next) => {
    try {
        let legacySession = {};
        if (req.terminalConfig.legacyProjectArgs) {
            const project = await Project.findOne({
                where: { user_id: req.session.userId },
                order: [['id', 'ASC']],
                attributes: ['uid'],
            });
            if (!project) return res.status(404).end();
            legacySession = { session_arg: project.uid };
        }
        res.json({
            ...legacySession,
            enabled: true,
            upload_enabled: !!getUploadConfig(),
            base_url: `${getApplicationBasePath()}/terminal-proxy/`,
            label: req.terminalConfig.label,
            cli: req.terminalConfig.cli,
        });
    } catch (error) {
        next(error);
    }
});

router.post('/terminal/upload', (req, res, next) => {
    const upload = getUploadConfig();
    if (!upload) return res.status(404).json({ error: 'Uploads disabled' });
    receiveImage(req, res, async (error) => {
        if (error) {
            const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
            return res.status(status).json({
                error:
                    status === 413
                        ? 'Image exceeds 15 MB'
                        : 'Expected one image file',
            });
        }
        if (!req.file) return res.status(400).json({ error: 'Image required' });
        if (req.file.size > MAX_IMAGE_BYTES) {
            return res.status(413).json({ error: 'Image exceeds 15 MB' });
        }
        const ext = imageExtension(req.file.buffer);
        if (!ext)
            return res.status(415).json({ error: 'Unsupported image type' });
        let temporary;
        try {
            await fs.mkdir(upload.dir, { recursive: true, mode: 0o750 });
            const timestamp = new Date()
                .toISOString()
                .replace(/[-:]/g, '')
                .replace('T', '-')
                .slice(0, 15);
            const name = `${timestamp}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
            temporary = path.join(
                upload.dir,
                `.${name}-${crypto.randomBytes(8).toString('hex')}.tmp`
            );
            // Write and set permissions through one descriptor: O_EXCL
            // never follows a planted symlink, and fchmod cannot be
            // redirected to another file between write and chmod.
            const handle = await fs.open(temporary, 'wx', 0o640);
            try {
                await handle.writeFile(req.file.buffer);
                await handle.chmod(0o640);
            } finally {
                await handle.close();
            }
            await fs.rename(temporary, path.join(upload.dir, name));
            temporary = null;
            await pruneUploads(upload.dir);
            res.json({ path: path.join(upload.hostDir, name) });
        } catch (writeError) {
            if (temporary) await fs.unlink(temporary).catch(() => {});
            next(writeError);
        }
    });
});

module.exports = router;
