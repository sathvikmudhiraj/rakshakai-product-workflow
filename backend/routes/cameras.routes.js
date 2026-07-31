const express = require("express");
const controller = require("../controllers/cameras.controller");

const router = express.Router();

router.get("/feeds", controller.feeds);
router.get("/sources", controller.sources);
router.post("/sources", controller.create);
router.patch("/sources/:id/config", controller.saveConfig);
router.post("/sources/:id/test", controller.testConnection);
router.post("/sources/:id/analyze", controller.analyzeSnapshot);
router.delete("/sources/:id", controller.remove);

module.exports = router;
