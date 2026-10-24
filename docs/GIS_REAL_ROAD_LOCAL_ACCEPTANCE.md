# GIS local routing and field acceptance

The local Compose service uses `ghcr.io/project-osrm/osrm-backend:v5.27.1`, internal port 5000, `OSRM_BASE_URL=http://osrm:5000`, and the MLD algorithm. The graph basename is selected by `OSRM_DATA_PATH` in `.env.docker`; the current value is `/data/telangana.osrm` (Telangana statewide). The API backend retains host port 5000. Do not start the backend service as part of graph preparation: its startup command runs migrations and an import.

## Telangana graph (current)

The graph is built from the [Geofabrik Southern Zone OpenStreetMap extract](https://download.geofabrik.de/asia/india/southern-zone.html) (`docker/osrm-data/southern-zone-latest.osm.pbf`, OSM data 2026-10-20). Telangana is cut out with `osmium extract --bbox=77.10,15.70,81.45,20.05 --strategy=complete_ways` (bbox padded beyond the state's 77.25–81.33 / 15.83–19.92 bounds; `complete_ways` keeps cross-border corridors connected). The staged pipeline lives in the ignored `data/osrm-telangana-build/` and the deployed graph in `docker/osrm-data/telangana.osrm*`; the previous Hyderabad graph (`region.osrm*`) is retained for rollback.

Preparation sequence: `osmium extract` (in the OSRM image via `apt-get install osmium-tool`), then `osrm-extract -p /opt/car.lua /data/telangana.osm.pbf`, `osrm-partition /data/telangana.osrm`, `osrm-customize --threads 8 /data/telangana.osrm`. Peak RAM was about 2.2 GB; the compose OSRM VM has about 6 GB. Do not attempt an all-India or full Southern-Zone graph on this machine.

Verified behavior (`node scripts/gis-osrm-telangana-acceptance.cjs`, run against a temporary localhost-only `osrm-routed` on the staged graph and again against the compose service on the internal network):

- Real road routes with geometry, steps, distance and duration between Hyderabad, Patancheru, Secunderabad, Shamshabad, Sangareddy, Warangal, Karimnagar, Nizamabad, Khammam and Mahbubnagar.
- Two OSRM alternatives on Hyderabad→Warangal, Patancheru→Karimnagar and Mahbubnagar→Khammam; alternatives are never fabricated when OSRM returns one route.
- `/nearest` snaps all ten cities to a road within 61 m.
- Far outside coverage (Kolkata, Chennai, Bengaluru, Delhi–Jaipur) OSRM never returns a positive-distance road route. Both endpoints may snap to a stray trunk-fragment node and answer a degenerate zero-length route (`code=Ok`, distance 0); the backend's `normalizeOsrmRoutes` validity filter rejects it, and the request falls back to the clearly labelled straight-line estimate with no ETA and navigation disabled. `complete_ways` extraction can leave sparse fragments of national highways (for example NH44) far outside the state; short routes along such a fragment are real road geometry but local street coverage outside Telangana is not present.

OpenStreetMap data is subject to the ODbL; preserve attribution.

## Graph preparation (general)

With a verified OSM PBF in the local ignored `docker/osrm-data` directory, the OSRM MLD preparation sequence is `osrm-extract -p /opt/car.lua /data/<region>.osm.pbf`, `osrm-partition /data/<region>.osrm`, and `osrm-customize /data/<region>.osrm`. Start only the OSRM service, without dependencies, after preparing its files. A running container is not a health check: test `/nearest` and `/route/v1/driving` on actual local coordinates and verify returned geometry, distance, duration and steps. Preparation can use substantial CPU, RAM and disk space.

Navigation uses two consecutive accurate fixes to confirm off-route or arrival. A deviation must exceed 50 metres and twice the reported accuracy; return to the route uses two fixes within the larger of 35 metres and the reported accuracy. Fixes with accuracy of 100 metres or worse cannot confirm deviation or arrival. These are initial local safeguards, not field-calibrated thresholds. Remaining distance is projected along route geometry, held monotonic between reroutes, and is not traffic-aware.

## Real-device field checklist — not yet performed

- Record device, route, network condition and GPS permission outcome; confirm the shown accuracy matches the device.
- Walk and, as a passenger, drive a normal urban route with a flyover and intersection. Record route match, remaining distance, maneuver timing and estimated remaining time.
- Manually pan while navigating, verify tracking continues, then re-enable Follow Location and verify the map recenters.
- Introduce temporary degraded GPS and mobile network conditions. Record GPS accuracy, false warnings, false reroutes and recovery behavior.
- Take a deliberate off-route turn. Record deviation, number of fixes and delay before rerouting; verify the original destination remains unchanged.
- Approach the destination and record arrival behavior. Verify arrival does not change dispatch, incident or investigation status.
- Repeat with a second route and note map coverage limitations, errors and the exact application build. Do not report field acceptance until the observations have been recorded.
