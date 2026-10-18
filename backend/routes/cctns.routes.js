const express = require("express");
const controller = require("../controllers/cctns.controller");

const router = express.Router();
router.get("/status", controller.status);
router.get("/search", controller.search);
router.get("/search/vehicles", controller.searchType("vehicle"));
router.get("/search/persons", controller.searchType("person"));
router.get("/search/missing-persons", controller.searchType("missing_person"));
router.get("/search/cases", controller.searchType("case"));
router.get("/search/property", controller.searchType("property"));
router.get("/records/:id", controller.getRecord);
router.post("/links", controller.createLink);
router.delete("/links/:id", controller.removeLink);
module.exports = router;
