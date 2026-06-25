from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = PROJECT_ROOT / "RakshakAI_Project_Report.docx"


BLUE = "2E74B5"
DARK_BLUE = "1F4D78"
TEAL = "087D78"
LIGHT_BLUE = "E8EEF5"
LIGHT_GRAY = "F2F4F7"
INK = "162322"
MUTED = "62716C"


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_borders(cell, color="DADCE0", size="6"):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in("w:tcBorders")
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = f"w:{edge}"
        element = borders.find(qn(tag))
        if element is None:
            element = OxmlElement(tag)
            borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), size)
        element.set(qn("w:space"), "0")
        element.set(qn("w:color"), color)


def set_cell_margins(table, top=80, start=120, bottom=80, end=120):
    tbl_pr = table._tbl.tblPr
    margins = tbl_pr.first_child_found_in("w:tblCellMar")
    if margins is None:
        margins = OxmlElement("w:tblCellMar")
        tbl_pr.append(margins)
    for name, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = margins.find(qn(f"w:{name}"))
        if node is None:
            node = OxmlElement(f"w:{name}")
            margins.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_table_geometry(table, widths):
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.autofit = False
    tbl_pr = table._tbl.tblPr
    tbl_w = tbl_pr.first_child_found_in("w:tblW")
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:w"), str(sum(widths)))
    tbl_w.set(qn("w:type"), "dxa")

    tbl_ind = tbl_pr.first_child_found_in("w:tblInd")
    if tbl_ind is None:
        tbl_ind = OxmlElement("w:tblInd")
        tbl_pr.append(tbl_ind)
    tbl_ind.set(qn("w:w"), "120")
    tbl_ind.set(qn("w:type"), "dxa")

    layout = tbl_pr.first_child_found_in("w:tblLayout")
    if layout is None:
        layout = OxmlElement("w:tblLayout")
        tbl_pr.append(layout)
    layout.set(qn("w:type"), "fixed")

    tbl_grid = table._tbl.tblGrid
    if tbl_grid is None:
        tbl_grid = OxmlElement("w:tblGrid")
        table._tbl.insert(0, tbl_grid)
    for child in list(tbl_grid):
        tbl_grid.remove(child)
    for width in widths:
        grid_col = OxmlElement("w:gridCol")
        grid_col.set(qn("w:w"), str(width))
        tbl_grid.append(grid_col)

    for row in table.rows:
        for idx, cell in enumerate(row.cells):
            cell.width = Inches(widths[idx] / 1440)
            tc_pr = cell._tc.get_or_add_tcPr()
            tc_w = tc_pr.first_child_found_in("w:tcW")
            if tc_w is None:
                tc_w = OxmlElement("w:tcW")
                tc_pr.append(tc_w)
            tc_w.set(qn("w:w"), str(widths[idx]))
            tc_w.set(qn("w:type"), "dxa")
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            set_cell_borders(cell)
    set_cell_margins(table)


def paragraph_text(cell, text, bold=False, color=INK):
    cell.text = ""
    paragraph = cell.paragraphs[0]
    paragraph.paragraph_format.space_after = Pt(0)
    run = paragraph.add_run(str(text))
    run.bold = bold
    run.font.color.rgb = RGBColor.from_string(color)
    run.font.size = Pt(9.5)
    return paragraph


def add_table(doc, headers, rows, widths, header_fill=LIGHT_GRAY):
    table = doc.add_table(rows=1, cols=len(headers))
    set_table_geometry(table, widths)
    hdr = table.rows[0].cells
    for idx, header in enumerate(headers):
        set_cell_shading(hdr[idx], header_fill)
        paragraph_text(hdr[idx], header, bold=True, color=DARK_BLUE)
    for row_values in rows:
        row_cells = table.add_row().cells
        for idx, value in enumerate(row_values):
            paragraph_text(row_cells[idx], value)
    doc.add_paragraph()
    return table


def add_bullet(doc, text):
    paragraph = doc.add_paragraph(style="List Bullet")
    paragraph.paragraph_format.space_after = Pt(4)
    paragraph.add_run(text)


def add_number(doc, text):
    paragraph = doc.add_paragraph(style="List Number")
    paragraph.paragraph_format.space_after = Pt(4)
    paragraph.add_run(text)


def add_callout(doc, title, body):
    table = doc.add_table(rows=1, cols=1)
    set_table_geometry(table, [9360])
    cell = table.cell(0, 0)
    set_cell_shading(cell, "F4F6F9")
    cell.text = ""
    p1 = cell.paragraphs[0]
    p1.paragraph_format.space_after = Pt(3)
    r1 = p1.add_run(title)
    r1.bold = True
    r1.font.color.rgb = RGBColor.from_string(TEAL)
    r1.font.size = Pt(11)
    p2 = cell.add_paragraph()
    p2.paragraph_format.space_after = Pt(0)
    r2 = p2.add_run(body)
    r2.font.color.rgb = RGBColor.from_string(INK)
    r2.font.size = Pt(10)
    doc.add_paragraph()


def set_styles(doc):
    section = doc.sections[0]
    section.top_margin = Inches(1)
    section.bottom_margin = Inches(1)
    section.left_margin = Inches(1)
    section.right_margin = Inches(1)
    section.header_distance = Inches(0.492)
    section.footer_distance = Inches(0.492)

    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(11)
    normal.font.color.rgb = RGBColor.from_string(INK)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.10

    for name, size, color, before, after in (
        ("Heading 1", 16, BLUE, 16, 8),
        ("Heading 2", 13, BLUE, 12, 6),
        ("Heading 3", 12, DARK_BLUE, 8, 4),
    ):
        style = styles[name]
        style.font.name = "Calibri"
        style.font.size = Pt(size)
        style.font.color.rgb = RGBColor.from_string(color)
        style.font.bold = True
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)

    for list_style in ("List Bullet", "List Number"):
        style = styles[list_style]
        style.font.name = "Calibri"
        style.font.size = Pt(11)
        style.paragraph_format.space_after = Pt(4)
        style.paragraph_format.line_spacing = 1.167


def add_footer(doc):
    footer = doc.sections[0].footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    footer.paragraph_format.space_before = Pt(6)
    run = footer.add_run("RakshakAI Product Workflow Report")
    run.font.size = Pt(9)
    run.font.color.rgb = RGBColor.from_string(MUTED)


def build_report():
    doc = Document()
    set_styles(doc)
    add_footer(doc)

    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title.paragraph_format.space_after = Pt(3)
    r = title.add_run("RakshakAI Project Report")
    r.bold = True
    r.font.size = Pt(24)
    r.font.color.rgb = RGBColor.from_string(TEAL)

    subtitle = doc.add_paragraph()
    subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
    subtitle.paragraph_format.space_after = Pt(16)
    s = subtitle.add_run("AI + GIS Powered Public Safety Intelligence Platform")
    s.font.size = Pt(12)
    s.font.color.rgb = RGBColor.from_string(MUTED)

    add_callout(
        doc,
        "Project Status",
        "RakshakAI is completed as a local working product prototype for SIH/demo use. It includes a frontend, local backend APIs, role-based portal login, local JSON database, GIS map, CCTV UI, missing-person workflow, live incidents, emergency response, alerts, and incident history.",
    )

    doc.add_heading("1. Product Overview", level=1)
    doc.add_paragraph(
        "RakshakAI is a public safety intelligence platform designed for large public events where authorities need centralized monitoring, fast emergency response, and citizen reporting. The product combines AI-assisted surveillance concepts, GIS monitoring, crowd analytics, missing-person reporting, alerting, and command dashboard workflows."
    )

    add_table(
        doc,
        ["Field", "Details"],
        [
            ["Product Name", "RakshakAI"],
            ["Product Type", "AI + GIS Powered Public Safety Intelligence Platform"],
            ["Primary Users", "Police Officer, Citizen, Admin"],
            ["Current Build", "Local full-stack prototype running in VS Code"],
            ["Project Folder", r"C:\Users\Admin\Documents\Codex\2026-05-22\rakshakai-product-workflow"],
        ],
        [2300, 7060],
        LIGHT_BLUE,
    )

    doc.add_heading("2. Problem Statement", level=1)
    doc.add_paragraph(
        "Large public events can face missing-person cases, overcrowding, panic situations, delayed emergency response, lost-item reports, and lack of centralized monitoring. RakshakAI addresses these issues by giving police and administrators a single command interface for monitoring, reporting, alerting, and incident response."
    )

    doc.add_heading("3. Product Workflow", level=1)
    add_table(
        doc,
        ["Step", "Workflow Stage", "Purpose"],
        [
            ["1", "Citizens / CCTV / Drones", "Inputs come from citizen reports, simulated CCTV feeds, drone monitoring, and command actions."],
            ["2", "Data Collection Layer", "Reports, camera status, zone status, alerts, and incidents are collected by the local backend."],
            ["3", "AI Processing Engine", "The demo simulates object/person detection, crowd detection, and risk classification using YOLO."],
            ["4", "GIS + Event Intelligence", "The map shows event areas, supports zoom, drag, search, and zone monitoring."],
            ["5", "Smart Command Dashboard", "Police/Admin users track metrics, incidents, CCTV, alerts, and response actions."],
            ["6", "Emergency Alert System", "Manual and automatic alerts are created, filtered, acknowledged, and cleared."],
            ["7", "Police & Citizen Response", "Police assign units and close incidents; citizens report cases and view alerts."],
        ],
        [800, 2600, 5960],
        LIGHT_BLUE,
    )

    doc.add_heading("4. User Roles", level=1)
    add_table(
        doc,
        ["Role", "Access / Responsibilities"],
        [
            ["Police Officer", "Dashboard, GIS monitoring, CCTV monitoring, missing-person cases, alerts, live incidents, emergency response, and incident history."],
            ["Citizen", "Missing-person reporting and alert viewing/acknowledgement."],
            ["Admin", "Full operational access, settings, device health, audit logs, and integration readiness."],
        ],
        [1900, 7460],
        LIGHT_GRAY,
    )

    doc.add_heading("5. Main Functionalities", level=1)
    for item in [
        "Secure portal login and registration with role selection.",
        "Role-based navigation for Police Officer, Citizen, and Admin.",
        "Dashboard summary cards for missing persons, active alerts, cameras, and monitored zones.",
        "GIS monitoring map with search, drag/pan, zoom controls, street map and satellite tile modes.",
        "CCTV monitoring dashboard with visual feed cards, AI overlays, live status, and disconnected state.",
        "Missing-person report form with image/file upload preview and local storage.",
        "Live incident queue with realistic police-style incident scenarios.",
        "Emergency response workflow for assigning units, suggesting routes, and closing incidents.",
        "Emergency alerts page with manual alert form, severity filters, acknowledgement, and clear all.",
        "Incident history page with closed cases and resolution analytics.",
        "Settings page with device health, audit logs, and production integration readiness.",
    ]:
        add_bullet(doc, item)

    doc.add_heading("6. Technology Used", level=1)
    add_table(
        doc,
        ["Layer", "Technology / File", "Usage"],
        [
            ["Frontend", "HTML, CSS, JavaScript", "Single-page command dashboard and role-based UI."],
            ["Backend", "Node.js HTTP server", "Local API server in server.js."],
            ["Database", "data/db.json", "Local JSON data store for users, reports, incidents, alerts, devices, and audit logs."],
            ["Maps", "OpenStreetMap and ArcGIS tile URLs", "Realistic web map tiles with search, pan, and zoom."],
            ["CCTV UI", "Local SVG assets", "Demo visual feeds for cameras and drone monitoring."],
            ["AI Workflow", "Demo fallback + production-ready AI service contract", "Uses YOLO object/person detection; can connect to Python service with AI_SERVICE_API_KEY auth."],
            ["Notifications", "Local alert API + Firebase placeholder", "Manual/automatic alerts now; Firebase can be connected through credentials."],
            ["Deployment Prep", "README, .env.example, PRODUCTION_SETUP.md", "Project is GitHub-ready and real-service-ready."],
        ],
        [1600, 2700, 5060],
        LIGHT_BLUE,
    )

    doc.add_heading("7. Frontend Pages / Views", level=1)
    add_table(
        doc,
        ["View", "Purpose"],
        [
            ["Login/Register", "Creates and validates Police, Admin, and Citizen accounts."],
            ["Dashboard", "Shows system overview, quick controls, live incidents, and emergency response actions."],
            ["GIS Monitoring", "Displays searchable, draggable, zoomable map with monitored zone status."],
            ["CCTV Monitoring", "Displays multi-camera matrix with AI-style overlays and stream health."],
            ["Missing Persons", "Allows citizen/police/admin reporting and shows case queue."],
            ["Alerts", "Allows police/admin manual alerts; all roles can view and acknowledge alerts."],
            ["History", "Shows closed incident history and resolution analytics for police/admin."],
            ["Settings", "Shows device health, audit logs, and integration readiness for admin."],
        ],
        [2200, 7160],
        LIGHT_GRAY,
    )

    doc.add_heading("8. Backend API Workflow", level=1)
    add_table(
        doc,
        ["API", "Method", "Function"],
        [
            ["/api/register", "POST", "Create user account with selected role."],
            ["/api/login", "POST", "Validate credentials and create session cookie."],
            ["/api/me", "GET", "Return current logged-in user."],
            ["/api/report-missing", "POST", "Create missing-person report, incident, and alert."],
            ["/api/reports", "GET", "Return missing-person reports."],
            ["/api/incidents/live", "GET", "Return active incidents."],
            ["/api/incidents/sample", "POST", "Create realistic demo incident and alert."],
            ["/api/incidents/:id/assign-unit", "PATCH", "Assign recommended police/medical unit."],
            ["/api/incidents/:id/status", "PATCH", "Close or update incident status."],
            ["/api/incidents/history", "GET/DELETE", "Read or clear closed incident history."],
            ["/api/alerts", "GET", "Return alerts for dashboard and citizen views."],
            ["/api/send-alert", "POST", "Create manual police/admin alert."],
            ["/api/alerts/:id/ack", "PATCH", "Acknowledge alert by user."],
            ["/api/alerts/clear", "PATCH", "Close all active alerts."],
            ["/api/camera-feeds", "GET", "Return CCTV/demo camera feed data."],
            ["/api/route", "GET", "Return route estimate through OSRM or local fallback."],
            ["/api/integrations/status", "GET", "Show real-service setup status."],
        ],
        [2900, 1200, 5260],
        LIGHT_BLUE,
    )

    doc.add_heading("9. Database Structure", level=1)
    doc.add_paragraph("The current local database is the JSON file data/db.json. It acts as the database for the VS Code demo version.")
    add_table(
        doc,
        ["Collection / Key", "Stores"],
        [
            ["users", "Name, email, role, and password for local demo authentication."],
            ["cameras", "Camera ID, zone, health, AI status, density, and visual feed asset."],
            ["zones", "GIS zone name, severity, and current crowd density."],
            ["reports", "Missing-person report details, uploaded image data, confidence, and camera match."],
            ["incidents", "Live and closed incident records, source, priority, assigned unit, ETA, timeline, and status."],
            ["alerts", "Alert type, severity, message, zone, location, status, and acknowledgement records."],
            ["devices", "Device health details for cameras and drones."],
            ["auditLogs", "Security and operational audit trail."],
        ],
        [2400, 6960],
        LIGHT_GRAY,
    )

    doc.add_heading("10. Module Workflows", level=1)
    doc.add_heading("10.1 Missing Person Workflow", level=2)
    for step in [
        "Citizen or police opens Missing Persons page.",
        "User enters name, age, last-seen location, and optional photo/file.",
        "Backend saves the report in data/db.json.",
        "System automatically creates a critical live incident.",
        "System automatically creates a critical alert.",
        "Police can run AI scan, assign unit, suggest route, and close the case.",
    ]:
        add_number(doc, step)

    doc.add_heading("10.2 Live Incident and Emergency Response Workflow", level=2)
    for step in [
        "Police/Admin opens a live incident or system creates one from report/AI/demo scenario.",
        "Incident appears in Live Incidents with severity, priority, source, unit recommendation, ETA, and SOP.",
        "Police assigns the suggested unit.",
        "Route engine calculates distance and time using OSRM or local fallback.",
        "Police closes incident after resolution.",
        "Closed incident moves into Incident History.",
    ]:
        add_number(doc, step)

    doc.add_heading("10.3 Alert Workflow", level=2)
    for step in [
        "Alert is created manually by Police/Admin or automatically by missing-person/incident/AI workflow.",
        "Alert is stored in data/db.json.",
        "All roles can view active alerts.",
        "Alerts can be filtered by all, critical, high, and medium.",
        "Citizens or police can acknowledge alerts.",
        "Police/Admin can clear active alerts.",
    ]:
        add_number(doc, step)

    doc.add_heading("11. Production Readiness", level=1)
    doc.add_paragraph(
        "The product is currently a complete local prototype. The code also includes production-ready integration placeholders so the same workflow can later connect to real services."
    )
    add_table(
        doc,
        ["Real Service", "Current Status", "How to Enable Later"],
        [
            ["MongoDB Atlas", "Prepared, not connected by default", "Set MONGODB_URI and replace local JSON persistence."],
            ["Firebase Push Notifications", "Prepared, not active by default", "Add Firebase server key/service account in .env."],
            ["Real RTSP CCTV", "Prepared through env config", "Add RTSP_CAMERA_URLS and connect processing pipeline."],
            ["Python AI Service", "Demo fallback active", "Run real-product/ai-service and set AI_SERVICE_URL."],
            ["Route Assignment", "OSRM/local fallback ready", "Set OSRM_BASE_URL or use public OSRM endpoint."],
            ["Deployment", "Ready for GitHub", "Deploy frontend/backend to Vercel/Render or another host."],
        ],
        [2300, 2800, 4260],
        LIGHT_BLUE,
    )

    doc.add_heading("12. How to Run in VS Code", level=1)
    add_callout(
        doc,
        "Project Folder",
        r"C:\Users\Admin\Documents\Codex\2026-05-22\rakshakai-product-workflow",
    )
    for step in [
        "Open the project folder in VS Code.",
        "Open the VS Code terminal.",
        "Run: npm install",            "Run: npm run dev",
            "Open: http://127.0.0.1:3000/",
        "Use Register to create Police Officer, Admin, or Citizen credentials.",
    ]:
        add_number(doc, step)

    doc.add_heading("13. Completion Status", level=1)
    add_table(
        doc,
        ["Area", "Status"],
        [
            ["Local frontend", "Completed"],
            ["Local backend APIs", "Completed"],
            ["Role-based login/register", "Completed"],
            ["GIS map workflow", "Completed"],
            ["CCTV monitoring UI", "Completed"],
            ["Missing-person workflow", "Completed"],
            ["Live incidents and emergency response", "Completed"],
            ["Manual alerts, acknowledgement, clear alerts", "Completed"],
            ["Incident history and clear history", "Completed"],
            ["GitHub-ready folder and .gitignore", "Completed"],
            ["Real CCTV/AI/MongoDB/Firebase production connection", "Prepared, requires credentials/services"],
        ],
        [4300, 5060],
        LIGHT_GRAY,
    )

    doc.add_heading("14. Conclusion", level=1)
    doc.add_paragraph(
        "RakshakAI is ready as a complete local demo and presentation-ready product prototype. It demonstrates how AI surveillance, GIS intelligence, citizen reporting, emergency alerting, live incident response, and police command-center workflows can work together in one public safety platform."
    )

    doc.save(OUT_PATH)
    return OUT_PATH


if __name__ == "__main__":
    print(build_report())
