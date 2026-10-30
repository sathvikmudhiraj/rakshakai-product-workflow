// The editor changes configured crew only. Incident deployments remain separate.
export function createUnitMembershipEditor({ root, api, onChanged = () => {} }) {
  if (!root) return { load: async () => {} };
  const select = root.querySelector("#unitMembershipUnitSelect");
  const list = root.querySelector("#unitMembershipList");
  const form = root.querySelector("#unitMembershipAddForm");
  const status = root.querySelector("#unitMembershipStatus");
  const add = root.querySelector("#openUnitMembershipAdd");
  const roles = ["member", "commander", "driver", "deputy", "medic"];
  let sequence = 0, loading = false, pending = false, members = [], units = [], roster = [];
  const element = (tag, text = "") => { const el = document.createElement(tag); el.textContent = text; return el; };
  function controls() {
    select.disabled = pending;
    root.querySelectorAll("button, input, select").forEach((control) => { if (control !== select) control.disabled = pending || loading; });
    add.disabled = pending || loading || !select.value || members.some((member) => member.locked);
  }
  function choices() {
    const officerSelect = form.elements.officerUserId;
    officerSelect.replaceChildren(new Option("Select officer", ""));
    const unit = units.find((item) => item.id === select.value);
    roster.filter((officer) => officer.active !== false && officer.status !== "inactive" && officer.dutyStatus !== "suspended"
      && !officer.deployments?.length && !officer.supportDeployments?.length
      && !members.some((member) => member.officerUserId === officer.id)
      && officer.stationId === (unit?.stationId || unit?.linkedStationId))
      .forEach((officer) => officerSelect.add(new Option(`${officer.name} · ${officer.badgeId || "No badge"}${officer.isDemo ? " · Demo/test" : ""}`, officer.id)));
  }
  async function loadMembers() {
    const current = ++sequence, unitId = select.value;
    form.hidden = true; members = []; list.replaceChildren(); status.textContent = "";
    if (!unitId) { loading = false; controls(); return; }
    loading = true; controls(); list.textContent = "Loading configured officers…";
    try {
      const response = await api(`/api/admin/response-units/${encodeURIComponent(unitId)}/members`);
      if (current !== sequence || select.value !== unitId) return;
      members = response.members || []; list.replaceChildren();
      list.append(element("p", response.crewReadiness?.reason || (!members.length ? "No configured crew. Add registered officers before dispatch." : "Configured officers")));
      for (const member of members) {
        const officer = member.officer || {}, row = element("article"); row.className = "unit-member-card";
        row.append(element("strong", officer.name || member.officerUserId));
        row.append(element("p", `${officer.badgeId || "No badge"} · ${officer.rank || "No rank"} · ${officer.station || "No station"}`));
        row.append(element("p", `${member.active === false ? "Inactive membership" : "Active membership"} · ${officer.dutyStatus || "Duty unknown"} · ${officer.availabilityStatus || "Availability unknown"}${officer.currentIncidentId ? ` · ${officer.currentIncidentId}` : ""}`));
        const role = element("select"); role.setAttribute("aria-label", `Membership role for ${officer.name || member.officerUserId}`);
        roles.forEach((value) => role.add(new Option(value, value, false, value === member.role)));
        role.addEventListener("change", () => mutate(unitId, member, "PATCH", { role: role.value }));
        const remove = element("button", "Remove"); remove.type = "button";
        remove.addEventListener("click", () => { if (window.confirm("Remove this configured membership? Deployment history will be preserved.")) mutate(unitId, member, "DELETE", {}); });
        const toggle = element("button", member.active === false ? "Activate membership" : "Deactivate membership"); toggle.type = "button";
        toggle.addEventListener("click", () => mutate(unitId, member, "PATCH", { active: member.active === false }));
        if (member.locked) row.append(element("p", "Locked: release active deployments before changing membership."));
        else row.append(role, toggle, remove);
        list.append(row);
      }
      choices();
    } catch (error) {
      if (current === sequence) { list.textContent = "Membership data could not be loaded."; status.textContent = error.message; }
    } finally { if (current === sequence) { loading = false; controls(); } }
  }
  async function mutate(unitId, member, method, body) {
    if (pending || loading) return;
    pending = true; controls(); status.textContent = "Saving…";
    try {
      await api(`/api/admin/response-units/${encodeURIComponent(unitId)}/members${member ? `/${encodeURIComponent(member.id)}` : ""}`, { method, body: { ...body, ...(member ? { expectedUpdatedAt: member.updatedAt } : {}) } });
      await loadMembers(); await onChanged(); status.textContent = "Membership saved.";
    } catch (error) { status.textContent = error.message; }
    finally { pending = false; controls(); }
  }
  let loadPromise;
  async function load() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      loading = true; controls(); status.textContent = "Loading units and officers…";
      try {
        const [unitResponse, officerResponse] = await Promise.all([api("/api/response-units"), api("/api/admin/police-users?includeDemo=true")]);
        units = unitResponse.units || []; roster = officerResponse.users || [];
        const selected = select.value;
        select.replaceChildren(new Option("Select a response unit", ""));
        units.forEach((unit) => select.add(new Option(`${unit.unitCode || unit.id} · ${unit.name || "Response unit"}`, unit.id)));
        select.value = units.some((unit) => unit.id === selected) ? selected : "";
        status.textContent = ""; await loadMembers();
      } catch (error) { status.textContent = error.message; }
      finally { loading = false; controls(); loadPromise = null; }
    })();
    return loadPromise;
  }
  select.addEventListener("change", loadMembers);
  add.addEventListener("click", () => { choices(); form.hidden = false; form.elements.officerUserId.focus(); });
  root.querySelector("#cancelUnitMembershipAdd").addEventListener("click", () => { form.hidden = true; form.reset(); });
  root.querySelector("#retryUnitMembership").addEventListener("click", load);
  form.addEventListener("submit", (event) => { event.preventDefault(); if (select.value && form.reportValidity()) mutate(select.value, null, "POST", { officerUserId: form.elements.officerUserId.value, role: form.elements.role.value }); });
  controls();
  return { load };
}
