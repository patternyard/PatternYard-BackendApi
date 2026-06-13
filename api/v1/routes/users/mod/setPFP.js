const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const UserManager = require("../../../db/UserManager");

/**
 * @typedef {Object} Utils
 * @property {UserManager} UserManager
 */

/**
 *
 * @param {any} app Express app
 * @param {Utils} utils Utils
 */
module.exports = (app, utils) => {
    app.post(
        "/api/v1/users/setpfpadmin",
        utils.cors(),
        utils.upload.single("picture"),
        async (req, res) => {
            const packet = req.body;

            const token = String(packet.token);

            const target = String(packet.target).toLowerCase();

            const pictureName = req.file;

            const login = await utils.UserManager.loginWithToken(token);
            if (!login.success) {
                utils.error(res, 400, "Reauthenticate");
                return;
            }
            const username = login.username;

            if (!(await utils.UserManager.hasModPerms(username))) {
                return utils.error(res, 403, "FeatureDisabledForThisAccount");
            }

            if (!(await utils.UserManager.existsByUsername(target))) {
                return utils.error(res, 400, "TargetNotFound");
            }

            if (!pictureName) {
                return utils.error(res, 400, "InvalidPicture");
            }

            if (
                pictureName.size >
                (Number(process.env.UploadSize) || 5) * 1024 * 1024
            ) {
                return utils.error(res, 400, "File too large");
            }

            const picture = fs.readFileSync(
                path.join(utils.homeDir, pictureName.path),
            );

            const allowedFormats = ["png", "jpeg", "gif"];

            // Validate the image type with sharp instead of mmmagic (native
            // libmagic does not build on serverless). sharp is already used to
            // resize below, so this adds no new dependency.
            let format;
            try {
                format = (await sharp(picture).metadata()).format;
            } catch (e) {
                console.error(`Image parse error: ${e}`);
                return utils.error(res, 400, "Invalid file type");
            }

            if (!allowedFormats.includes(format)) {
                return utils.error(res, 400, `Invalid file type, ${format}`);
            }

            const resized_picture =
                format == "gif"
                    ? picture
                    : await sharp(picture).resize(100, 100).toBuffer();

            await utils.UserManager.setProfilePicture(target, resized_picture);

            utils.logs.sendAdminUserLog(
                username,
                target,
                "Admin or mod has updated user's profile picture.",
                0xf4a220,
            );

            res.status(200);
            res.header("Content-Type", "application/json");
            res.json({ success: true });
        },
    );
};
