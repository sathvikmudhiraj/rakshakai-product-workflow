const express = require("express");
const controller = require("../controllers/incidents.controller");

const router = express.Router();

router.get("/", controller.listLive);
router.post("/", controller.create);
router.post("/sample", controller.createSample);
router.get("/history", controller.history);
router.delete("/history", controller.clearHistory);
router.get("/:id/timeline", controller.timeline);
router.post("/:id/recommend-unit", controller.recommendUnit);
router.patch("/:id/location", controller.updateLocation);
router.post("/:id/confirm-location", controller.confirmLocation);
router.post("/:id/assign-unit", controller.assignUnit);
router.post("/:id/close", controller.close);
router.patch("/:id/status", controller.updateStatus);
router.get("/:id", controller.getOne);

module.exports = router;
