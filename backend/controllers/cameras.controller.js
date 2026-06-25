const { legacyHandler } = require("../services/legacyRoute.service");

exports.feeds = legacyHandler("/api/camera-feeds");
exports.sources = legacyHandler("/api/camera-sources");
exports.saveConfig = legacyHandler((req) => `/api/camera-sources/${req.params.id}/config`);
exports.testConnection = legacyHandler((req) => `/api/camera-sources/${req.params.id}/test`);
