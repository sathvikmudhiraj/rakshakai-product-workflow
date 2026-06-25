const express = require("express");
const controller = require("../controllers/deviceHealth.controller");

const router = express.Router();

router.get("/", controller.list);

module.exports = router;
