const { legacyHandler } = require("../services/legacyRoute.service");

exports.me = legacyHandler("/api/me");
exports.login = legacyHandler("/api/login");
exports.register = legacyHandler("/api/register");
exports.logout = legacyHandler("/api/logout");
exports.changePassword = legacyHandler("/api/change-password");
