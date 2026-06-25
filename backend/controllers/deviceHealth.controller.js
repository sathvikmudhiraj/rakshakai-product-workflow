const { legacyHandler } = require("../services/legacyRoute.service");

exports.list = legacyHandler("/api/devices/health");
