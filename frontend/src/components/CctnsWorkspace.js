let dependencies = null;
let requestVersion = 0;
let debounceTimer = null;
let lastFocused = null;
let detailVersion = 0;
let operatorKey = null;

const CATEGORY_LABELS = [
  ["all", "Search All"], ["case", "FIR / Cases"], ["crime", "Crime / Offence"], ["person", "Persons"],
  ["vehicle", "Vehicles"], ["missing_person", "Missing Persons"], ["property", "Property"], ["station", "Police Stations"]
];
const QUICK_GROUPS = [["all", "All"], ["vehicle", "Vehicles"], ["case", "FIR / Cases"], ["person", "Persons"], ["property", "Property"], ["missing_person", "Missing Persons"]];
const CRIME_TYPES = ["", "Theft", "Vehicle Theft", "Burglary", "Robbery", "Assault", "Kidnapping", "Fraud", "Cybercrime", "Narcotics", "Smuggling", "Human Trafficking", "Arms-related Case", "Property Offence", "Missing Person", "Other"];
const initialState = () => ({ category: "all", group: "all", query: "", filters: {}, page: 1, filtersOpen: false, records: [], total: 0, counts: {}, selected: null, detail: null, adapter: null, loading: false, error: "", linkStatus: "" });
const state = initialState();

function root() { return document.querySelector("#cctnsWorkspace"); }
function el(tag, className = "", text = "") { const element = document.createElement(tag); if (className) element.className = className; if (text !== "") element.textContent = text; return element; }
function badge(status) { return el("span", `cctns-status cctns-status-${String(status || "unknown").toLowerCase().replace(/[^a-z]+/g, "-")}`, status || "UNKNOWN"); }
function formattedDate(value) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? "Unavailable" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
function selectedId() { return state.selected?.id || state.detail?.record?.id || ""; }
function hasOperatorAccess() { return ["Admin", "Police Officer"].includes(dependencies?.getContext()?.user?.role); }

export function configureCctns(nextDependencies) { dependencies = nextDependencies; }

export function resetCctnsWorkspace() {
  requestVersion++; detailVersion++;
  window.clearTimeout(debounceTimer);
  Object.assign(state, initialState());
  operatorKey = null; lastFocused = null;
  root()?.replaceChildren();
}

function contextSearchParams() {
  const params = new URLSearchParams(location.search);
  const type = params.get("type"); const query = params.get("query");
  if (type && ["vehicle", "case", "person", "missing_person", "property", "station"].includes(type)) state.category = type;
  if (query !== null) state.query = query;
}

function searchParams() {
  const type = state.category === "crime" ? "all" : state.category;
  return { q: state.query, type, ...state.filters, group: state.group, page: state.page, limit: 50 };
}

async function loadResults() {
  if (!dependencies || !hasOperatorAccess()) return;
  const version = ++requestVersion;
  state.loading = true; state.error = ""; render();
  try {
    const result = await dependencies.api.search(searchParams());
    if (version !== requestVersion) return;
    state.records = result.records || []; state.total = result.total || 0; state.counts = result.counts || {}; state.adapter = result.adapter; state.searchState = result.state;
  } catch (error) {
    if (version !== requestVersion) return;
    state.records = []; state.total = 0; state.error = error.message || "CCTNS Adapter unavailable";
  } finally {
    if (version === requestVersion) { state.loading = false; render(); }
  }
}

async function selectRecord(id, focus = false) {
  const version = ++detailVersion;
  state.selected = state.records.find((record) => record.id === id) || { id };
  state.detail = null; state.error = ""; state.linkStatus = ""; render();
  try {
    const detail = await dependencies.api.getRecord(id);
    if (version !== detailVersion) return;
    state.detail = detail; state.selected = detail.record;
    render();
    if (focus) root()?.querySelector(".cctns-detail-title")?.focus();
  } catch (error) { if (version === detailVersion) { state.error = error.message; render(); } }
}

function renderCategoryNav(container) {
  const tabs = el("div", "cctns-category-tabs", ""); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "CCTNS search category");
  CATEGORY_LABELS.forEach(([id, label]) => {
    const button = el("button", id === state.category ? "active" : "", label); button.type = "button"; button.dataset.cctnsCategory = id;
    button.setAttribute("role", "tab"); button.setAttribute("aria-selected", String(id === state.category)); tabs.append(button);
  });
  container.append(tabs);
}

function filterSelect(label, key, options, value = "") {
  const wrap = el("label", "cctns-filter"); wrap.append(el("span", "", label));
  const select = el("select"); select.dataset.cctnsFilter = key;
  options.forEach(([optionValue, optionLabel]) => { const option = el("option", "", optionLabel); option.value = optionValue; option.selected = String(value) === String(optionValue); select.append(option); });
  wrap.append(select); return wrap;
}

function filterInput(label, key, type = "text") {
  const wrap = el("label", "cctns-filter"); wrap.append(el("span", "", label));
  const input = el("input"); input.type = type; input.dataset.cctnsFilter = key; input.value = state.filters[key] || "";
  if (type === "number") { input.min = "0"; input.max = "120"; }
  wrap.append(input); return wrap;
}

function renderFilters(container) {
  const controls = el("div", "cctns-search-controls");
  const search = el("label", "cctns-global-search"); search.append(el("span", "sr-only", "Search simulated CCTNS records"));
  const input = el("input"); input.type = "search"; input.value = state.query; input.placeholder = "Search FIR, case, vehicle, person, property, offence..."; input.dataset.cctnsSearch = "true"; input.autocomplete = "off"; search.append(input); controls.append(search);
  const filters = el("div", `cctns-filters${state.filtersOpen ? " open" : ""}`); filters.id = "cctnsFilters";
  filters.append(
    filterSelect("Record Type", "type", [["", "All"], ...CATEGORY_LABELS.filter(([id]) => !["all", "crime"].includes(id))], state.filters.type),
    filterSelect("Crime Type", "crimeType", CRIME_TYPES.map((item) => [item, item || "All"]), state.filters.crimeType),
    filterSelect("Year", "year", [["", "All"], ["2026", "2026"]], state.filters.year),
    filterSelect("State", "state", [["", "All"], ["Telangana", "Telangana"]], state.filters.state),
    filterSelect("District", "district", [["", "All"], ["Sangareddy", "Sangareddy"]], state.filters.district),
    filterSelect("Police Station", "stationId", [["", "All"], ...(dependencies.getContext().stations || []).map((station) => [station.stationId || station.id, station.stationName || station.name])], state.filters.stationId),
    filterSelect("Case Status", "status", [["", "All"], ["STOLEN", "Stolen"], ["RECOVERED", "Recovered"], ["ACTIVE", "Active"], ["UNDER INVESTIGATION", "Under Investigation"], ["MISSING", "Missing"], ["WANTED REFERENCE", "Wanted reference"]], state.filters.status)
  );
  if (["person", "missing_person"].includes(state.category)) filters.append(
    filterInput("Name", "name"), filterInput("Minimum age", "ageMin", "number"), filterInput("Maximum age", "ageMax", "number"),
    filterSelect("Gender if recorded", "gender", [["", "All"], ["Female", "Female"], ["Male", "Male"], ["Other", "Other"]], state.filters.gender),
    filterInput("FIR / Case Reference", "caseReference"), filterInput("Missing Person Reference", "missingReference")
  );
  if (state.category === "property") filters.append(filterInput("Serial Number", "serialNumber"), filterInput("Property Type", "propertyType"), filterInput("Brand", "brand"), filterInput("Description", "description"), filterInput("FIR / Case Reference", "caseReference"));
  controls.append(filters);
  const mobileToggle = el("button", "ghost cctns-filter-toggle", "Filters"); mobileToggle.type = "button"; mobileToggle.dataset.cctnsToggleFilters = "true"; mobileToggle.setAttribute("aria-controls", "cctnsFilters"); mobileToggle.setAttribute("aria-expanded", String(state.filtersOpen)); controls.append(mobileToggle);
  container.append(controls);
}

function renderResultCard(record) {
  const card = el("button", `cctns-result-card ${record.id === selectedId() ? "active" : ""}`); card.type = "button"; card.dataset.cctnsRecord = record.id; card.setAttribute("aria-pressed", String(record.id === selectedId()));
  const title = el("div", "cctns-result-title"); title.append(el("span", "cctns-record-icon", record.type.slice(0, 3).toUpperCase()), el("strong", "", record.title), badge(record.status));
  const meta = el("div", "cctns-result-meta"); meta.append(el("span", "", record.type.replace(/_/g, " ")), el("span", "", record.subtitle || record.crimeType), el("span", "", record.station), el("time", "", `Updated ${formattedDate(record.updatedAt)}`));
  card.append(title, meta, el("span", "cctns-simulated-badge", "SIMULATED CCTNS RECORD")); return card;
}

function renderResults(container) {
  const panel = el("section", "panel cctns-results-panel");
  const header = el("div", "panel-head"); const headCopy = el("div"); headCopy.append(el("span", "eyebrow", "Search results"), el("h2", "", "Search Results")); header.append(headCopy, el("span", "chip", `${state.total || 0} records`)); panel.append(header);
  const groups = el("div", "cctns-result-groups", ""); QUICK_GROUPS.forEach(([id, label]) => { const button = el("button", state.group === id ? "active" : "", `${label} (${state.counts[id] || 0})`); button.type = "button"; button.dataset.cctnsGroup = id; groups.append(button); }); panel.append(groups);
  const list = el("div", "cctns-results-list"); list.setAttribute("aria-live", "polite");
  if (state.loading) { list.append(el("div", "cctns-loading", "Searching simulated CCTNS records…")); }
  else if (state.error) { list.append(el("div", "empty-state", state.error)); }
  else if (!state.records.length) { list.append(el("div", "empty-state", state.searchState === "ADAPTER_UNAVAILABLE" ? "CCTNS Adapter unavailable" : "No matching simulated CCTNS records found.")); }
  else {
    if (state.searchState === "POSSIBLE_MATCH") list.append(el("div", "cctns-possible-match", "Possible Match — Human verification required"));
    state.records.forEach((record) => list.append(renderResultCard(record)));
  }
  panel.append(list);
  if (state.total > 50) {
    const pagination = el("nav", "cctns-detail-actions"); pagination.setAttribute("aria-label", "Search result pages");
    const pages = Math.ceil(state.total / 50);
    for (const [label, delta] of [["Previous", -1], ["Next", 1]]) {
      const button = el("button", "ghost", label); button.type = "button"; button.dataset.cctnsPage = String(delta);
      button.disabled = state.loading || (delta < 0 ? state.page <= 1 : state.page >= pages); pagination.append(button);
    }
    pagination.append(el("span", "", `Page ${state.page} of ${pages}`)); panel.append(pagination);
  }
  container.append(panel);
}

function detailField(label, value) { const item = el("div", "cctns-detail-field"); item.append(el("span", "", label), el("strong", "", value || "Not recorded")); return item; }
function linkedList(label, records) { const section = el("section", "cctns-linked-section"); section.append(el("h3", "", label)); if (!records?.length) section.append(el("p", "", "No linked records available.")); else records.forEach((record) => { const button = el("button", "cctns-linked-card", `${record.title} · ${record.subtitle} · ${record.status}`); button.type = "button"; button.dataset.cctnsRecord = record.id; section.append(button); }); return section; }
function linkedIncidents(links) { const section = el("section", "cctns-linked-section"); section.append(el("h3", "", "Linked RakshakAI Incidents")); if (!links?.length) section.append(el("p", "", "No RakshakAI incidents linked.")); else links.forEach((link) => section.append(el("p", "cctns-incident-link", `Incident ${link.incidentId} · verified link · ${formattedDate(link.linkedAt)}`))); return section; }
function activityLog(entries) {
  const labels = { cctns_record_viewed: "Record viewed", cctns_link_confirmed: "Incident link confirmed", cctns_link_rejected: "Link attempt rejected", cctns_reference_unlinked: "Incident link removed" };
  const section = el("section", "cctns-linked-section"); section.append(el("h3", "", "Activity Log"));
  if (!entries?.length) section.append(el("p", "", "No recorded activity yet."));
  else entries.forEach((entry) => section.append(el("p", "", `${labels[entry.action] || "Record activity"} · ${formattedDate(entry.timestamp)}`)));
  return section;
}

function renderDetail(container) {
  const panel = el("aside", "panel cctns-detail-panel");
  if (!state.detail?.record) { panel.append(el("div", "empty-state", "Select a simulated CCTNS record to review its lawful, human-verified context.")); container.append(panel); return; }
  const record = state.detail.record;
  const header = el("div", "cctns-detail-head"); const copy = el("div"); copy.append(el("span", "eyebrow", "Selected record details"), el("h2", "cctns-detail-title", record.title), badge(record.status), el("p", "", "SIMULATED CCTNS RECORD · Human verification required")); header.append(copy); panel.append(header);
  copy.querySelector("h2").tabIndex = -1;
  const fields = el("div", "cctns-detail-fields");
  if (record.type === "vehicle") [
    ["Record ID", record.id], ["Registration Number", record.registrationNumber], ["Vehicle Type", record.vehicleType], ["Make / Model", record.makeModel], ["Color", record.color], ["Year", record.vehicleYear], ["Chassis Number", maskIdentifier(record.chassisNumber)], ["Engine Number", maskIdentifier(record.engineNumber)], ["Date of Theft", record.dateOfTheft], ["Police Station", record.station], ["FIR Number", record.firNumber], ["Case Number", record.caseNumber]
  ].forEach(([label, value]) => fields.append(detailField(label, value)));
  else if (record.type === "person") [["Record ID", record.id], ["Name", record.personName], ["Age", record.age], ["Gender", record.gender], ["Police Station", record.station], ["Case Reference", record.caseReference]].forEach(([label, value]) => fields.append(detailField(label, value)));
  else if (record.type === "missing_person") [["Name", record.personName], ["Age", record.age], ["Gender", record.gender], ["Missing Since", record.missingSince], ["Last Known Location", record.lastKnownLocation], ["Police Station", record.station], ["Reference Number", record.referenceNumber]].forEach(([label, value]) => fields.append(detailField(label, value)));
  else if (record.type === "property") [["Property Reference", record.propertyReference], ["Serial Number", maskIdentifier(record.serialNumber)], ["Property Type", record.propertyType], ["Brand", record.brand], ["FIR / Case", record.firNumber || record.caseNumber], ["Police Station", record.station]].forEach(([label, value]) => fields.append(detailField(label, value)));
  else [["Record ID", record.id], ["Crime / Offence", record.crimeType], ["FIR Number", record.firNumber], ["Case Number", record.caseNumber], ["Police Station", record.station], ["District", record.district], ["Incident Date", record.incidentDate], ["Assigned Investigation Reference", record.assignedInvestigationReference]].forEach(([label, value]) => fields.append(detailField(label, value)));
  panel.append(fields);
  if (record.referenceImage) { const image = el("img", "cctns-reference-image"); image.src = record.referenceImage; image.alt = "Reference Image — Simulated"; panel.append(el("h3", "", "Reference Image — Simulated"), image); }
  if (record.remarks || record.description) panel.append(el("p", "cctns-remarks", record.remarks || record.description));
  panel.append(linkedList("Linked Cases", state.detail.linkedCases), linkedList("Linked Property", state.detail.linkedProperty), linkedIncidents(state.detail.links), activityLog(state.detail.activityLog));
  const actions = el("div", "cctns-detail-actions"); [
    ["VIEW FULL RECORD", "view"], ["SEARCH SIMILAR RECORDS", "similar"], ["LINK TO INCIDENT", "link"]
  ].forEach(([label, action]) => { const button = el("button", action === "link" ? "primary" : "ghost", label); button.type = "button"; button.dataset.cctnsAction = action; actions.append(button); }); panel.append(actions);
  if (state.linkStatus) panel.append(el("p", "form-status success", state.linkStatus));
  container.append(panel);
}

function maskIdentifier(value) { const text = String(value || ""); return text.length > 5 ? `${text.slice(0, 3)}••••${text.slice(-4)}` : text || "Not recorded"; }

function renderLinkDialog(container) {
  const dialog = el("dialog", "cctns-link-dialog"); dialog.id = "cctnsLinkDialog"; dialog.setAttribute("aria-labelledby", "cctnsLinkDialogTitle");
  const form = el("form", "form"); form.method = "dialog"; form.dataset.cctnsLinkForm = "true";
  form.append(el("h2", "", "Link CCTNS Record to Incident")); form.querySelector("h2").id = "cctnsLinkDialogTitle";
  const selectLabel = el("label"); selectLabel.append(el("span", "", "Select Incident")); const select = el("select"); select.name = "incidentId"; select.required = true; select.append(new Option("Select an authorized incident", "")); (dependencies.getContext().incidents || []).forEach((incident) => select.append(new Option(`${incident.id} · ${incident.title || "Incident"}`, incident.id))); selectLabel.append(select);
  const reason = el("label"); reason.append(el("span", "", "Verification Reason")); const textarea = el("textarea"); textarea.name = "verificationReason"; textarea.required = true; textarea.maxLength = 500; textarea.rows = 3; textarea.placeholder = "Record reviewed and link verified by authorized operator"; reason.append(textarea);
  const confirm = el("label", "cctns-confirmation"); const check = el("input"); check.type = "checkbox"; check.name = "humanConfirmed"; check.required = true; confirm.append(check, document.createTextNode(" I confirm this link is based on human verification."));
  const actions = el("div", "form-actions"); const cancel = el("button", "ghost", "Cancel"); cancel.type = "button"; cancel.dataset.cctnsCloseDialog = "true"; const submit = el("button", "primary", "Confirm Link"); submit.type = "submit"; actions.append(cancel, submit); form.append(selectLabel, reason, confirm, actions, el("p", "form-status", "This action is audited. CCTNS simulator records do not establish identity or guilt.")); dialog.append(form); container.append(dialog);
}

function render() {
  const container = root(); if (!container || !dependencies) return;
  if (!hasOperatorAccess()) { container.replaceChildren(el("div", "panel empty-state", "CCTNS is available only to authorized Police and Admin users.")); return; }
  const active = document.activeElement;
  const focusSelector = container.contains(active) && active.matches("[data-cctns-search], [data-cctns-filter]")
    ? active.hasAttribute("data-cctns-search") ? "[data-cctns-search]" : `[data-cctns-filter="${active.dataset.cctnsFilter}"]` : null;
  const selection = focusSelector && active.tagName === "INPUT" && active.type !== "number" ? [active.selectionStart, active.selectionEnd] : null;
  container.textContent = "";
  const header = el("div", "command-page-head cctns-page-head"); const copy = el("div"); copy.append(el("span", "eyebrow", "CCTNS Adapter / Simulator"), el("h2", "", "CCTNS Search"), el("p", "", "Search and review police crime and investigation records")); const status = el("div", "cctns-adapter-status"); status.append(el("strong", "", "SIMULATED CCTNS RECORDS"), el("small", "", state.adapter?.message || "CCTNS Adapter / Simulator for project demonstration"), badge(state.adapter?.status || "AVAILABLE")); header.append(copy, status); container.append(header);
  renderCategoryNav(container); renderFilters(container);
  const layout = el("div", "cctns-workspace-grid"); renderResults(layout); renderDetail(layout); container.append(layout); renderLinkDialog(container);
  if (focusSelector) {
    const input = container.querySelector(focusSelector); input?.focus({ preventScroll: true });
    if (selection && input?.setSelectionRange) input.setSelectionRange(...selection);
  }
}

function openLinkDialog() { const dialog = root()?.querySelector("#cctnsLinkDialog"); if (!dialog) return; lastFocused = document.activeElement; dialog.showModal?.(); dialog.querySelector("select")?.focus(); }
function closeLinkDialog() { const dialog = root()?.querySelector("#cctnsLinkDialog"); dialog?.close?.(); lastFocused?.focus?.(); }

function bind() {
  const container = root(); if (!container || container.dataset.bound) return; container.dataset.bound = "true";
  container.addEventListener("click", async (event) => {
    const category = event.target.closest("[data-cctns-category]"); if (category) { state.page = 1; state.category = category.dataset.cctnsCategory; state.group = "all"; for (const key of ["type", "name", "ageMin", "ageMax", "gender", "caseReference", "missingReference", "serialNumber", "propertyType", "brand", "description"]) delete state.filters[key]; loadResults(); return; }
    const group = event.target.closest("[data-cctns-group]"); if (group) { state.page = 1; state.group = group.dataset.cctnsGroup; loadResults(); return; }
    const page = event.target.closest("[data-cctns-page]"); if (page) { state.page += Number(page.dataset.cctnsPage); loadResults(); return; }
    const record = event.target.closest("[data-cctns-record]"); if (record) { selectRecord(record.dataset.cctnsRecord, true); return; }
    if (event.target.closest("[data-cctns-toggle-filters]")) { const filters = root().querySelector("#cctnsFilters"); state.filtersOpen = filters.classList.toggle("open"); event.target.closest("button").setAttribute("aria-expanded", String(state.filtersOpen)); return; }
    const action = event.target.closest("[data-cctns-action]")?.dataset.cctnsAction;
    if (action === "link") { openLinkDialog(); return; }
    if (action === "similar") { state.page = 1; state.query = state.detail?.record?.crimeType || state.detail?.record?.subtitle || ""; state.category = "all"; state.group = "all"; loadResults(); return; }
    if (action === "view") { root().querySelector(".cctns-detail-fields")?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (event.target.closest("[data-cctns-close-dialog]")) closeLinkDialog();
  });
  container.addEventListener("input", (event) => {
    if (!event.target.matches("[data-cctns-search]")) return;
    state.page = 1; state.query = event.target.value; window.clearTimeout(debounceTimer); debounceTimer = window.setTimeout(loadResults, 250);
  });
  container.addEventListener("change", (event) => { if (event.target.matches("[data-cctns-filter]")) { state.page = 1; state.filters[event.target.dataset.cctnsFilter] = event.target.value; loadResults(); } });
  container.addEventListener("submit", async (event) => {
    if (!event.target.matches("[data-cctns-link-form]")) return; event.preventDefault();
    const submit = event.target.querySelector('[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    const recordId = selectedId(); const actor = operatorKey;
    const data = new FormData(event.target);
    try {
      await dependencies.api.createLink({ cctnsRecordId: recordId, incidentId: data.get("incidentId"), verificationReason: data.get("verificationReason"), humanConfirmed: data.get("humanConfirmed") === "on" });
      if (actor !== operatorKey || recordId !== selectedId()) return;
      closeLinkDialog(); await selectRecord(recordId);
      if (actor !== operatorKey || recordId !== selectedId()) return;
      state.linkStatus = "Incident link confirmed and audited."; render();
    } catch (error) { if (actor === operatorKey) { const status = event.target.querySelector(".form-status"); status.classList.add("error"); status.textContent = error.message; } }
    finally { submit.disabled = false; }
  });
}

export function renderCctnsWorkspace() {
  const user = dependencies?.getContext()?.user;
  const key = user ? `${user.id}:${user.role}` : null;
  if (key !== operatorKey) { resetCctnsWorkspace(); operatorKey = key; }
  contextSearchParams(); bind(); render(); loadResults();
}
