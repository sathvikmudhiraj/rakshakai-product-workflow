const { api } = require("./core.service");

function legacyHandler(pathOrBuilder) {
  return (req, res, next) => {
    const mappedPath = typeof pathOrBuilder === "function" ? pathOrBuilder(req) : pathOrBuilder;
    const queryIndex = req.originalUrl.indexOf("?");
    const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";
    const url = new URL(`${mappedPath}${query}`, "http://localhost:5000");
    api(req, res, url).catch(next);
  };
}

module.exports = { legacyHandler };
