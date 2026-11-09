# GIS real-device acceptance

Status: **PENDING MANUAL FIELD TEST**. Desktop browsers, Playwright, responsive emulation, and simulated coordinates do not satisfy this checklist. Do not mark it passed until Sathvik records the result from a physical phone.

## Safe local phone access

**REAL DEVICE HTTPS BLOCKER (out of the box).** The development server and the Compose Nginx configuration serve HTTP only, and browser geolocation on a phone requires a secure context. `http://<LAN-IP>:3000` is therefore not an acceptable field-test URL until one of the two options below is completed. Do not create a public tunnel and do not port-forward the app.

### Option A (recommended): mkcert LAN HTTPS, local-machine only

One workstation setup, no network administrator required:

1. Install mkcert on this workstation (<https://github.com/FiloSottile/mkcert/releases>).
2. Run `powershell -ExecutionPolicy Bypass -File scripts\prepare-device-https.ps1`. It installs the mkcert local CA, issues a certificate for the workstation's LAN address (keys are kept in `D:\rakshak-gis\device-https`, outside the repository), and prints the exact start command.
3. Start the HTTPS dev server with the printed environment variables (`VITE_DEV_HTTPS_KEY` / `VITE_DEV_HTTPS_CERT`); `frontend/vite.config.js` enables HTTPS only when both are set, so normal development is unchanged.
4. One-time phone step: copy the mkcert root CA (`mkcert -install` prints its location) to the phone and trust it, then open the printed URL (for example `https://192.168.x.x:3000`). Never bypass a certificate warning; confirm the certificate shows as valid before granting location permission.
5. Remove the temporary certificate and CA trust on the phone when field acceptance is complete.

### Option B: organization private CA (for managed test networks)

1. Ask the authorized test-network administrator to reserve a private DNS name, for example `rakshakai.test.lan`, resolving only to this workstation's LAN address.
2. Have that administrator issue a certificate for that name from the organization's local CA, and install the CA root on the test phone. Keep the certificate/private key outside the repository.
3. Bind a local reverse proxy to the workstation LAN interface on `443`, proxying only to `http://127.0.0.1:3001` (or start the vite dev server with the same environment variables from Option A). Restrict the firewall rule to the authorized test subnet. Proxy `/api/` and `/socket.io/` to the same local frontend origin so the existing relative API and Socket.IO paths remain same-origin.
4. Verify `https://rakshakai.test.lan` from the phone. Never use a certificate warning bypass.

The exact phone URL is **blocked** until Option A or B is completed; with Option A it is `https://<workstation-LAN-IP>:3000` as printed by the script.

## Tester record

- Tester / device / OS / browser:
- App build / commit:
- Date and authorized Wi-Fi or LAN:
- HTTPS certificate name and issuer:
- Route start / destination:
- Weather, GPS reception, and network condition:

## Manual checklist

Perform movement tests while walking safely or while a passenger in a vehicle; do not operate the phone while driving.

1. Open GIS on the physical phone.
2. Confirm Street Map loads.
3. Search for a location.
4. Select the search result.
5. Tap Use My Location.
6. Accept GPS permission.
7. Verify the location marker.
8. Verify the accuracy circle.
9. Verify displayed position changes with real movement.
10. Enable Follow.
11. Verify the map follows GPS.
12. Manually pan the map.
13. Verify Follow disables.
14. Re-enable Follow.
15. Set Start from current location.
16. Set Destination.
17. Calculate a real road route.
18. Verify real road geometry follows streets.
19. Verify road distance.
20. Verify ETA.
21. Inspect alternate route(s), if the provider returns them.
22. Select another route.
23. Start Navigation.
24. Verify the navigation arrow/icon.
25. Verify the next maneuver.
26. Verify remaining distance changes.
27. Verify remaining ETA changes.
28. Safely test off-route behavior.
29. Verify reroute uses the current GPS position.
30. Reach the destination.
31. Verify arrival state.
32. End Navigation.
33. Switch Street ↔ Satellite during route/navigation.
34. Verify the route remains.
35. Rotate portrait ↔ landscape.
36. Verify no control clipping.
37. Verify the collapsed Layers control does not block map interaction.
38. Background the browser briefly and return.
39. Verify navigation/GPS state behaves safely.
40. Test temporary network interruption and recovery.

## Result

Record pass/fail, screenshots, route observations, and any GPS or reroute anomalies here. A missing result is **not** a pass.
