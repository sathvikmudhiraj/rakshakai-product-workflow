const express = require("express");
const controller = require("../controllers/audit.controller");

const router = express.Router();

router.get("/", controller.list);

module.exports = router;
