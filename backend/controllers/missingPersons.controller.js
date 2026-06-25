const { legacyHandler } = require("../services/legacyRoute.service");

exports.list = legacyHandler("/api/reports");
exports.create = legacyHandler("/api/report-missing");
