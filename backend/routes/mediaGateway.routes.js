const express = require("express");
const controller = require("../controllers/mediaGateway.controller");

const router = express.Router();
router.get("/health", controller.health);
router.post("/cameras/:id/start", controller.start);
router.post("/cameras/:id/stop", controller.stop);

module.exports = router;
