const base = process.env.ACCEPTANCE_BASE || "http://localhost:3001";
(async () => {
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@rakshakai.local", password: "demo123" })
  });
  const setCookie = login.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];
  const loginBody = await login.json().catch(() => null);
  console.log("login:", login.status, loginBody?.user?.email || JSON.stringify(loginBody));

  const headers = { Cookie: cookie };

  // Real Telangana road route through the application backend (Hyderabad -> Warangal).
  const route = await fetch(`${base}/api/maps/route`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      start: { lat: 17.385, lng: 78.4867, label: "Hyderabad" },
      destination: { lat: 17.9689, lng: 79.5941, label: "Warangal" },
      mode: "driving"
    })
  });
  const routeBody = await route.json();
  console.log("\nroute:", route.status, "provider:", routeBody.provider, "isApproximate:", routeBody.isApproximate);
  console.log("routes:", (routeBody.routes || []).length, "distanceKm:", routeBody.distanceKm, "durationMin:", routeBody.durationMinutes);
  console.log("steps(first route):", routeBody.routes?.[0]?.steps?.length ?? routeBody.steps?.length ?? "n/a");
  console.log("geometry points:", routeBody.geometry?.coordinates?.length);

  // Road snap in Secunderabad.
  const snap = await fetch(`${base}/api/maps/snap`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ lat: 17.4399, lng: 78.5011 })
  });
  const snapBody = await snap.json();
  console.log("\nsnap Secunderabad:", snap.status, JSON.stringify(snapBody).slice(0, 220));

  // Outside-coverage behavior through the backend (Kolkata -> Howrah).
  const outside = await fetch(`${base}/api/maps/route`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      start: { lat: 22.5726, lng: 88.3639, label: "Kolkata" },
      destination: { lat: 22.595, lng: 88.3199, label: "Howrah" },
      mode: "driving"
    })
  });
  const outsideBody = await outside.json();
  console.log("\noutside route:", outside.status, "provider:", outsideBody.provider, "isApproximate:", outsideBody.isApproximate, "label:", outsideBody.routes?.[0]?.label, "durationMinutes:", outsideBody.routes?.[0]?.durationMinutes, "routeType:", outsideBody.routeType);

  const health = await (await fetch(`${base}/api/health`)).json();
  console.log("\nhealth routing:", JSON.stringify(health.routing));
})().catch((e) => { console.error(e); process.exitCode = 1; });
