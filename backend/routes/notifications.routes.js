const express = require("express");
const controller = require("../controllers/notifications.controller");
const router = express.Router();

router.get("/", controller.list);
router.post("/mark-all-read", controller.markAllRead);
router.patch("/:id/read", controller.read);
router.get("/:id/details", controller.details);
router.post("/:id/opened", controller.opened);

module.exports = router;
