import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";
import cspConfig from "../csp.config.cjs";

// Vite injects CSS through style tags during development; production Nginx does not allow inline styles.
const DEVELOPMENT_CSP = cspConfig.buildRakshakaiCsp({ environment: "development" }).header;

function rakshakaiDevelopmentCsp() {
  return {
    name: "rakshakai-development-csp",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const acceptsHtml = String(req.headers.accept || "").includes("text/html");
        if (acceptsHtml || req.url === "/" || req.url?.endsWith(".html")) {
          res.setHeader("Content-Security-Policy", DEVELOPMENT_CSP);
        }
        next();
      });
    }
  };
}

function cssRequestPathExists(root, publicDir, pathname) {
  const relativePath = pathname.replace(/^\/+/, "");
  const candidates = [
    path.join(root, relativePath),
    path.join(publicDir, relativePath)
  ];
  return candidates.some((candidate) => fs.existsSync(candidate));
}

function rakshakaiStylesheetFallbackGuard() {
  return {
    name: "rakshakai-stylesheet-fallback-guard",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!["GET", "HEAD"].includes(req.method || "")) return next();
        const acceptsHtml = String(req.headers.accept || "").includes("text/html");
        let pathname = "";
        try {
          pathname = decodeURIComponent(new URL(req.url || "/", "http://rakshakai.local").pathname);
        } catch {
          return next();
        }
        const isStylesheet = pathname.endsWith(".css");
        const isKnownFilesystemStylesheet = pathname.startsWith("/src/")
          || pathname.startsWith("/node_modules/")
          || pathname.startsWith("/assets/");
        if (!isStylesheet || acceptsHtml || !isKnownFilesystemStylesheet) return next();
        if (cssRequestPathExists(server.config.root, server.config.publicDir, pathname)) return next();
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.end(`Stylesheet not found: ${pathname}`);
      });
    }
  };
}

export default defineConfig({
  plugins: [rakshakaiDevelopmentCsp(), rakshakaiStylesheetFallbackGuard()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5000",
        changeOrigin: false,
        configure(proxy) {
          proxy.on("error", (error, req, res) => {
            if (res.headersSent) return;
            res.writeHead(503, {
              "Content-Type": "application/json; charset=utf-8",
              "X-Content-Type-Options": "nosniff"
            });
            res.end(JSON.stringify({ error: "Backend unavailable" }));
          });
        }
      }
    }
  }
});
