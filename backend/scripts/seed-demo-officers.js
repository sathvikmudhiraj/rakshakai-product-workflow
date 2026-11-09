const { readDatabase, writeSelectedRecords, withAssignmentLock, addAuditLog } = require("../services/core.service");
const { closePool } = require("../services/postgres.service");
const users = require("../repositories/users.repository");
const officers = require("../repositories/policeOfficers.repository");
const members = require("../repositories/responseUnitMembers.repository");
const audits = require("../repositories/auditLogs.repository");
const policeStations = require("../repositories/policeStations.repository");
const responseUnits = require("../repositories/responseUnits.repository");
const { planDemoOfficerAssignments } = require("../services/demoOfficerAssignments.service");

async function main() {
  const apply = process.argv.includes("--apply");
  await withAssignmentLock(async () => {
    const db = await readDatabase();
    const plan = planDemoOfficerAssignments(db);
    // The local demo registry is authoritative for these clearly marked records.
    // Persisting it is required before the officer FK rows can be written in a
    // fresh development database; no non-demo station or unit is synthesized.
    const demoStations = (db.policeStations || []).filter((station) => station.isDemo === true || station.source === "demo_seed");
    const demoStationByRef = new Map(demoStations.flatMap((station) => [station.id, station.stationId, station.stationCode].filter(Boolean).map((ref) => [String(ref), station])));
    const demoUnits = (db.responseUnits || []).filter((unit) => {
      const type = String(unit.unitType || unit.unitSubtype || unit.subtype || "").toLowerCase();
      const station = demoStationByRef.get(String(unit.stationId || unit.linkedStationId || ""));
      return (unit.isDemo === true || unit.source === "demo_seed") && station && (type === "" || type === "police" || type === "patrol" || type.startsWith("police_") || type.endsWith("_patrol"));
    }).map((unit) => {
      const station = demoStationByRef.get(String(unit.stationId || unit.linkedStationId || ""));
      return station ? { ...unit, stationId: station.id, linkedStationId: station.id } : unit;
    });
    if (apply && (plan.users.length || plan.officers.length || plan.memberships.length)) {
      for (const [collection, records] of [["users", plan.users], ["policeOfficers", plan.officers], ["responseUnitMembers", plan.memberships]]) {
        db[collection] ||= [];
        for (const record of records) {
          const index = db[collection].findIndex((item) => item.id === record.id);
          if (index === -1) db[collection].push(record); else db[collection][index] = record;
        }
      }
      for (const station of demoStations) {
        const index = db.policeStations.findIndex((item) => item.id === station.id);
        if (index === -1) db.policeStations.push(station); else db.policeStations[index] = station;
      }
      for (const unit of demoUnits) {
        const index = db.responseUnits.findIndex((item) => item.id === unit.id);
        if (index === -1) db.responseUnits.push(unit); else db.responseUnits[index] = unit;
      }
      const audit = addAuditLog(db, "demo_officer_assignments_seeded", { id: "local_demo_setup", role: "Admin" }, null, JSON.stringify({ users: plan.users.length, officers: plan.officers.length, memberships: plan.memberships.length, stations: demoStations.length, units: demoUnits.length, deleted: 0 }));
      await writeSelectedRecords(db, [[policeStations, demoStations], [responseUnits, demoUnits], [users, plan.users], [officers, plan.officers], [members, plan.memberships], [audits, [audit]]]);
    }
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", matchedDemoAccounts: plan.matched, accountsUpdated: plan.users.length, profilesUpdated: plan.officers.length, membershipsAdded: plan.memberships.length, accountsDeleted: 0, retainedTestAccounts: plan.retainedTestAccounts }));
  });
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(closePool);
