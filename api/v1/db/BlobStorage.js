const { Readable } = require("stream");
const { EventEmitter } = require("events");
const { put, del, head, list, copy } = require("@vercel/blob");

/**
 * A MinIO-Client-compatible adapter backed by Vercel Blob.
 *
 * Vercel Blob has a single flat namespace (no buckets), so we emulate buckets
 * by prefixing object keys with `${bucket}/`. Only the subset of the MinIO
 * client API actually used by UserManager is implemented:
 *   putObject, getObject, removeObject, removeObjects, statObject,
 *   bucketExists, makeBucket, setBucketLifecycle, copyObject,
 *   listObjects, listObjectsV2
 *
 * The store is public, so reads fetch the object's public URL. Writes still go
 * through authenticated backend routes, matching the original MinIO behaviour.
 */
class BlobStorageClient {
    constructor() {
        // Token is read from BLOB_READ_WRITE_TOKEN automatically by @vercel/blob.
        this._warnedLifecycle = false;
    }

    _path(bucket, name) {
        return `${bucket}/${name}`;
    }

    /**
     * Store an object. Mirrors minioClient.putObject(bucket, name, buffer).
     */
    async putObject(bucket, name, body) {
        return put(this._path(bucket, name), body, {
            access: "public",
            addRandomSuffix: false,
            allowOverwrite: true,
        });
    }

    /**
     * Read an object as a Node Readable stream.
     * Mirrors minioClient.getObject(bucket, name) which returns a stream.
     * Rejects (like MinIO) when the object does not exist.
     */
    async getObject(bucket, name) {
        const meta = await head(this._path(bucket, name)); // throws if missing
        const res = await fetch(meta.url);
        if (!res.ok) {
            throw new Error(
                `Failed to fetch blob ${this._path(bucket, name)}: ${res.status}`,
            );
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        return Readable.from(buffer);
    }

    /**
     * Delete a single object. Mirrors minioClient.removeObject(bucket, name).
     */
    async removeObject(bucket, name) {
        await del(this._path(bucket, name));
    }

    /**
     * Delete multiple objects. Mirrors minioClient.removeObjects(bucket, names, cb).
     */
    removeObjects(bucket, names, cb) {
        const paths = names.map((n) => this._path(bucket, n));
        del(paths)
            .then(() => cb && cb(null))
            .catch((err) => cb && cb(err));
    }

    /**
     * Stat an object. Mirrors minioClient.statObject(bucket, name, cb).
     * On a missing object the error carries code "NotFound" (what objectExists checks).
     */
    statObject(bucket, name, cb) {
        head(this._path(bucket, name))
            .then((meta) => cb(null, { size: meta.size, etag: meta.etag }))
            .catch((err) => {
                // @vercel/blob throws BlobNotFoundError for missing objects.
                // Its `name` is just "Error", so detect via the constructor name
                // (or the message, "...blob does not exist").
                const isMissing =
                    err &&
                    ((err.constructor && err.constructor.name === "BlobNotFoundError") ||
                        /does not exist|not found/i.test(err.message || ""));
                if (isMissing) {
                    const e = new Error("Not Found");
                    e.code = "NotFound";
                    return cb(e);
                }
                cb(err);
            });
    }

    /**
     * Buckets don't exist in Blob — always report present.
     * Supports both callback (minio) and promise call styles.
     */
    bucketExists(name, cb) {
        if (typeof cb === "function") return cb(null, true);
        return Promise.resolve(true);
    }

    /**
     * No-op: Blob has no buckets to create.
     */
    makeBucket(name, cb) {
        if (typeof cb === "function") return cb(null);
        return Promise.resolve();
    }

    /**
     * No-op: Blob has no per-prefix lifecycle policies.
     * cacheControlMaxAge on put() is the closest equivalent if needed later.
     */
    async setBucketLifecycle() {
        if (!this._warnedLifecycle) {
            console.warn(
                "setBucketLifecycle is a no-op on Vercel Blob (no lifecycle policies).",
            );
            this._warnedLifecycle = true;
        }
    }

    /**
     * Copy an object. Mirrors minioClient.copyObject(bucket, newKey, "/bucket/oldKey").
     */
    async copyObject(bucket, newKey, source) {
        const from = source.replace(/^\/+/, ""); // strip leading slash
        return copy(from, this._path(bucket, newKey), {
            access: "public",
            addRandomSuffix: false,
            allowOverwrite: true,
        });
    }

    /**
     * List objects under a prefix. Mirrors minioClient.listObjects /
     * listObjectsV2, returning an EventEmitter that emits "data" ({ name }),
     * "error", and "end". `name` is the key WITHIN the bucket (bucket prefix
     * stripped), matching MinIO semantics.
     */
    listObjects(bucket, prefix = "", _recursive = true) {
        const emitter = new EventEmitter();
        const fullPrefix = this._path(bucket, prefix);
        const stripLen = bucket.length + 1; // remove "bucket/"

        (async () => {
            try {
                let cursor;
                do {
                    const result = await list({
                        prefix: fullPrefix,
                        cursor,
                        limit: 1000,
                    });
                    for (const blob of result.blobs) {
                        emitter.emit("data", {
                            name: blob.pathname.slice(stripLen),
                            size: blob.size,
                        });
                    }
                    cursor = result.hasMore ? result.cursor : undefined;
                } while (cursor);
                emitter.emit("end");
            } catch (err) {
                emitter.emit("error", err);
            }
        })();

        return emitter;
    }

    listObjectsV2(bucket, prefix = "", recursive = true) {
        return this.listObjects(bucket, prefix, recursive);
    }
}

module.exports = { BlobStorageClient };
