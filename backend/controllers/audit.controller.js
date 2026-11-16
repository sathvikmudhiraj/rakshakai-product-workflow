const { legacyHandler } = require("../services/legacyRoute.service");
const { readDatabase, userFromReqForSession, hasRole } = require("../services/core.service");
const { getDatabaseMode } = require("../services/postgres.service");
const auditLogsRepository = require("../repositories/auditLogs.repository");

const CATEGORIES = new Set(["all", "personnel", "units", "incidents", "security", "other"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function categoryFor(action = "") {
  const key = String(action).toLowerCase();
  if (key.includes("police") || key.includes("officer") || key.includes("station")) return "personnel";
  if (key.includes("unit") || key.includes("member") || key.includes("assignment")) return "units";
  if (key.includes("incident") || key.includes("dispatch") || key.includes("erss")) return "incidents";
  if (["auth", "session", "account", "password"].some((part) => key.includes(part))) return "security";
  return "other";
}

function validDate(value) {
  return !value || (DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
}

exports.list = async (req, res, next) => {
  try {
    const user = await userFromReqForSession(req);
    if (!user) return res.status(401).json({ error: "Authentication required" });
    if (!hasRole(user, ["Admin"])) return res.status(403).json({ error: "Access denied", message: "Access denied" });

    // Preserve the original response for existing clients that request the unfiltered trail.
    const paginated = ["limit", "offset", "search", "category", "actor", "from", "to"].some((key) => req.query[key] !== undefined);
    if (!paginated) {
      const db = await readDatabase();
      return res.json({ auditLogs: db.auditLogs || [] });
    }

    const search = String(req.query.search || "").trim().slice(0, 200);
    const actor = String(req.query.actor || "").trim().slice(0, 120);
    const category = String(req.query.category || "all").toLowerCase();
    const from = String(req.query.from || "");
    const to = String(req.query.to || "");
    if (!CATEGORIES.has(category)) return res.status(400).json({ error: "Invalid audit category" });
    if (!validDate(from) || !validDate(to) || (from && to && from > to)) return res.status(400).json({ error: "Invalid audit date range" });
    const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 25));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    let page;
    if (getDatabaseMode() === "postgres") {
      page = await auditLogsRepository.listPage({ limit, offset, search, category, actor, from, to });
    } else {
      const db = await readDatabase();
      let rows = db.auditLogs || [];
      const matches = (row) => {
        const haystack = JSON.stringify(row).toLowerCase();
        return (!search || haystack.includes(search.toLowerCase()))
          && (!actor || `${row.actorName || ""} ${row.actorId || ""}`.toLowerCase().includes(actor.toLowerCase()))
          && (category === "all" || categoryFor(row.action) === category)
          && (!from || String(row.timestamp || row.createdAt || "").slice(0, 10) >= from)
          && (!to || String(row.timestamp || row.createdAt || "").slice(0, 10) <= to);
      };
      rows = rows.filter(matches).sort((a, b) => Date.parse(b.timestamp || b.createdAt || 0) - Date.parse(a.timestamp || a.createdAt || 0));
      page = { auditLogs: rows.slice(offset, offset + limit), total: rows.length };
    }
    return res.json({ ...page, limit, offset, hasMore: offset + page.auditLogs.length < page.total });
  } catch (error) {
    return next(error);
  }
};
exports.integrations = legacyHandler("/api/integrations/status");
