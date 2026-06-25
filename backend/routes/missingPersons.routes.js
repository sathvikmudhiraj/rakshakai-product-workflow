const express = require("express");
const controller = require("../controllers/missingPersons.controller");

const router = express.Router();

router.get("/", controller.list);
router.post("/", controller.create);

module.exports = router;
