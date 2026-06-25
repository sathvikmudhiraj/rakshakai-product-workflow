const { legacyHandler } = require("../services/legacyRoute.service");

exports.list = legacyHandler("/api/alerts");
exports.send = legacyHandler("/api/send-alert");
exports.clear = legacyHandler("/api/alerts/clear");
exports.ack = legacyHandler((req) => `/api/alerts/${req.params.id}/ack`);
exports.acknowledge = legacyHandler((req) => `/api/alerts/${req.params.id}/acknowledge`);
