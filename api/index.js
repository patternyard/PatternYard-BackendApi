// Vercel serverless entry point.
//
// All incoming requests are rewritten to this function (see vercel.json).
// We await the memoized one-time initialization (DB connect + route loading)
// and then hand the request off to the Express app, which owns the full
// "/api/v1/..." path space exactly as it did when run as a long-lived server.

// Trace pins: route files are loaded dynamically by endpointLoader, so Vercel's
// file tracer (NFT) cannot follow their requires. Any npm package used ONLY
// inside a route must be referenced statically here so it gets bundled into the
// function. `jszip` is the only such package (sharp/dotenv/fs/path are already
// traced via index.js / UserManager.js).
require("jszip");

// NOTE: require the app lazily inside the handler so that a throw at module
// load time (read-only FS, missing env, etc.) can be surfaced in the response
// instead of an opaque FUNCTION_INVOCATION_FAILED. Memoized after first success.
let _mod = null;
function load() {
    if (!_mod) _mod = require("../index.js");
    return _mod;
}

module.exports = async (req, res) => {
    let app, init;
    try {
        ({ app, init } = load());
        await init();
    } catch (err) {
        console.error("Backend boot failed:", err);
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(
            JSON.stringify({
                error: "BootError",
                message: err && err.message,
                stack: err && err.stack ? err.stack.split("\n").slice(0, 8) : null,
            }),
        );
        return;
    }

    return app(req, res);
};
