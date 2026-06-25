const { legacyHandler } = require("../services/legacyRoute.service");

exports.dashboard = legacyHandler("/api/dashboard");
exports.dashboardSummary = legacyHandler("/api/dashboard/summary");
exports.route = legacyHandler("/api/route");
exports.zones = legacyHandler("/api/zones");
exports.listLive = legacyHandler("/api/incidents");
exports.getOne = legacyHandler((req) => `/api/incidents/${req.params.id}`);
exports.timeline = legacyHandler((req) => `/api/incidents/${req.params.id}/timeline`);
exports.create = legacyHandler("/api/incidents");
exports.createSample = legacyHandler("/api/incidents/sample");
exports.recommendUnit = legacyHandler((req) => `/api/incidents/${req.params.id}/recommend-unit`);
exports.updateLocation = legacyHandler((req) => `/api/incidents/${req.params.id}/location`);
exports.confirmLocation = legacyHandler((req) => `/api/incidents/${req.params.id}/confirm-location`);
exports.history = legacyHandler("/api/incidents/history");
exports.clearHistory = legacyHandler("/api/incidents/history");
exports.assignUnit = legacyHandler((req) => `/api/incidents/${req.params.id}/assign-unit`);
exports.close = legacyHandler((req) => `/api/incidents/${req.params.id}/close`);
exports.updateStatus = legacyHandler((req) => `/api/incidents/${req.params.id}/status`);
