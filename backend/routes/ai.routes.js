const express = require("express");
const controller = require("../controllers/ai.controller");

const router = express.Router();

router.post("/run-scan", controller.runScan);
router.post("/analyze-frame", controller.analyzeFrame);
router.get("/health", controller.health);

module.exports = router;
