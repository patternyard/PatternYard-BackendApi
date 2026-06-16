const UserManager = require("../../db/UserManager");

/**
 * @typedef {Object} Utils
 * @property {UserManager} UserManager
 */

/**
 * Serves saved-project assets from our own store (Vercel Blob `project-assets`),
 * matching the path format the editor's PRIMARY asset store requests:
 *
 *   `${PM_ASSET_CDN_ROOT}/file/penguinmod-warm-tier-s2-cf/${projectId}_${assetId}.${ext}`
 *
 * Previously this path was served by an upstream Backblaze B2 CDN. Pointing
 * PM_ASSET_CDN_ROOT at this backend lets a self-hosted instance serve its own
 * project assets with no external CDN dependency. The bytes come from the same
 * `project-assets` bucket the writer and the existing
 * `/api/v1/projects/backupassetget` route already use, so this is a
 * primary-path mirror of that tested backup route (same viewing-enabled gate).
 *
 * @param {any} app Express app
 * @param {Utils} utils Utils
 */
module.exports = (app, utils) => {
    app.get(
        "/file/penguinmod-warm-tier-s2-cf/:asset_name",
        async (req, res) => {
            if (
                !(await utils.UserManager.getRuntimeConfigItem("viewingEnabled"))
            ) {
                return utils.error(res, 503, "Viewing is disabled");
            }

            const asset_name = String(req.params.asset_name);

            if (
                !asset_name ||
                asset_name.startsWith("0_") ||
                !asset_name.includes("_")
            ) {
                return utils.error(res, 400, "No asset");
            }

            const asset = await utils.UserManager.backupAssetCheck(asset_name);

            if (!asset) {
                return utils.error(res, 400, "Not found");
            }

            res.header("Cache-Control", "public, max-age=999999999");
            return res.send(asset);
        },
    );
};
