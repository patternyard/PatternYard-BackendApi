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
        "/api/v1/users/setpfp",
        utils.cors(),
        utils.upload.single("picture"),
        async (req, res) => {
            const packet = req.query;

            const token = String(packet.token);

            const pictureName = req.file;

            const login = await utils.UserManager.loginWithToken(token);
            if (!login.success) {
                utils.error(res, 400, "Reauthenticate");
                return;
            }
            const username = login.username;

            if (!pictureName) {
                return utils.error(res, 400, "No picture was provided");
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

            const allowedFormats = ["png", "jpeg"];

            // ATODO: make sure the pfp isnt too big

            // Validate the image type with sharp instead of mmmagic (native
            // libmagic does not build on serverless). sharp is already used to
            // resize below, so this adds no new dependency.
            let format;
            try {
                format = (await sharp(picture).metadata()).format;
            } catch (e) {
                return utils.error(res, 400, "Invalid file type");
            }

            if (!allowedFormats.includes(format)) {
                return utils.error(res, 400, "Invalid file type");
            }

            let resized_picture;

            try {
                resized_picture = await sharp(picture)
                    .resize(100, 100)
                    .toBuffer();
            } catch (e) {
                console.warn(`Sharp error: ${e}`);
                return utils.error(res, 400, "Invalid image");
            }

            await utils.UserManager.setProfilePicture(
                username,
                resized_picture,
            );

            res.status(200);
            res.header("Content-Type", "application/json");
            res.json({ success: true });
        },
    );
};
