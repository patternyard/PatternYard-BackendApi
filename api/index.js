// Vercel serverless entry point.
//
// All incoming requests are rewritten to this function (see vercel.json).
// We await the memoized one-time initialization (DB connect + route loading)
// and then hand the request off to the Express app, which owns the full
// "/api/v1/..." path space exactly as it did when run as a long-lived server.
const { app, init } = require("../index.js");

// Trace pins: route files are loaded dynamically by endpointLoader, so Vercel's
// file tracer (NFT) cannot follow their requires. Any npm package used ONLY
// inside a route must be referenced statically here so it gets bundled into the
// function. `jszip` is the only such package (sharp/dotenv/fs/path are already
// traced via index.js / UserManager.js).
require("jszip");

module.exports = async (req, res) => {
    try {
        await init();
    } catch (err) {
        console.error("Failed to initialize backend:", err);
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "InitializationError" }));
        return;
    }

    return app(req, res);
};
