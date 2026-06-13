const { Redis } = require("@upstash/redis");

/**
 * A shared, serverless-safe store for express-rate-limit backed by Upstash
 * Redis over HTTP. The default MemoryStore counts hits per-process, which is
 * useless on Vercel where each invocation may be a fresh isolate — every
 * client would effectively get unlimited requests. This store keeps the count
 * in Redis so the limit is enforced across all invocations.
 *
 * Implements a fixed-window counter (INCR + PEXPIRE), matching the semantics
 * of express-rate-limit's built-in MemoryStore. Compatible with the v6/v7/v8
 * Store interface: increment() -> { totalHits, resetTime }.
 */
class RedisRateLimitStore {
    /**
     * @param {object} [opts]
     * @param {string} [opts.prefix] key namespace, keeps rate-limit keys
     *   distinct from any other Redis usage.
     */
    constructor(opts = {}) {
        this.prefix = opts.prefix || "rl:";
        this.client = new Redis({
            url: process.env.KV_REST_API_URL,
            token: process.env.KV_REST_API_TOKEN,
        });
    }

    // express-rate-limit calls init() with the resolved options so the store
    // can learn the window length.
    init(options) {
        this.windowMs = options.windowMs;
    }

    prefixKey(key) {
        return `${this.prefix}${key}`;
    }

    async increment(key) {
        const redisKey = this.prefixKey(key);
        const totalHits = await this.client.incr(redisKey);

        // On the first hit of a new window, set the expiry. Only doing this when
        // the counter just became 1 keeps the window fixed rather than sliding
        // it forward on every request.
        if (totalHits === 1) {
            await this.client.pexpire(redisKey, this.windowMs);
        }

        let ttl = await this.client.pttl(redisKey);
        // pttl returns -1 (no expiry) or -2 (missing). Guard both so we always
        // have a sane window and never leak a key without a TTL.
        if (ttl < 0) {
            await this.client.pexpire(redisKey, this.windowMs);
            ttl = this.windowMs;
        }

        return {
            totalHits,
            resetTime: new Date(Date.now() + ttl),
        };
    }

    async decrement(key) {
        await this.client.decr(this.prefixKey(key));
    }

    async resetKey(key) {
        await this.client.del(this.prefixKey(key));
    }
}

module.exports = { RedisRateLimitStore };
