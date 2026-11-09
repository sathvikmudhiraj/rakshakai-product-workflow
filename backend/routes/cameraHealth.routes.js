const express = require("express");
const controller = require("../controllers/cameraHealth.controller");

const router = express.Router();
router.get("/", controller.summary);
router.patch("/thresholds", controller.thresholds);
router.get("/:id", controller.camera);
router.post("/:id/observations", controller.observe);
router.post("/:id/maintenance", controller.maintenance);
router.post("/:id/simulate", controller.simulate);
router.post("/alerts/:id/acknowledge", controller.acknowledge);
module.exports = router;
