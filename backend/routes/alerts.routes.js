const express = require("express");
const controller = require("../controllers/alerts.controller");

const router = express.Router();

router.get("/", controller.list);
router.post("/", controller.send);
router.patch("/clear", controller.clear);
router.patch("/:id/ack", controller.ack);
router.post("/:id/acknowledge", controller.acknowledge);

module.exports = router;
