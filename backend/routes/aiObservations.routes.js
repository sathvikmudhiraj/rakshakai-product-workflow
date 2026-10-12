const express = require("express");
const controller = require("../controllers/aiObservations.controller");

const router = express.Router();
router.get("/", controller.list);
router.get("/:id/frame", controller.frame);
router.get("/:id", controller.get);
router.post("/:id/review", controller.review);

module.exports = router;
