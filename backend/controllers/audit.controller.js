const { legacyHandler } = require("../services/legacyRoute.service");

exports.list = legacyHandler("/api/audit-logs");
exports.integrations = legacyHandler("/api/integrations/status");
