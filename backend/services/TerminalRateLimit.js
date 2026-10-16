// Shared by HTTP and WebSocket handshakes. No timer or background service.
function createTerminalLimiter(clock = Date.now) {
    const buckets = new Map();
    return (key, maximum = 120) => {
        const now = clock();
        for (const [name, bucket] of buckets) {
            if (bucket.until <= now) buckets.delete(name);
        }
        let bucket = buckets.get(key);
        if (!bucket) {
            if (buckets.size >= 10000) return false;
            bucket = { until: now + 60000, count: 0 };
            buckets.set(key, bucket);
        }
        return ++bucket.count <= maximum;
    };
}

module.exports = {
    createTerminalLimiter,
    allowTerminalRequest: createTerminalLimiter(),
};
