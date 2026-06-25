const express = require("express");
const controller = require("../controllers/cameras.controller");

const router = express.Router();

router.get("/feeds", controller.feeds);
router.get("/sources", controller.sources);
router.patch("/sources/:id/config", controller.saveConfig);
router.post("/sources/:id/test", controller.testConnection);

module.exports = router;
