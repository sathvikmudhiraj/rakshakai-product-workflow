const { buildRakshakaiCsp } = require("/etc/rakshakai/csp.config.cjs");

const { header } = buildRakshakaiCsp({
  environment: process.env.CSP_ENV || "production",
  connectSrc: process.env.CSP_CONNECT_SRC || "",
  imgSrc: process.env.CSP_IMG_SRC || ""
});

process.stdout.write(header);
