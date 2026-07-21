import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createApiRouter } from "./server/routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, ".env.local") });
dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// ngrok / reverse proxies terminate TLS upstream — trust X-Forwarded-* 
app.set("trust proxy", true);

app.use(cors());
app.use(express.json({ limit: "25mb" }));

// Help browsers treat tunnel traffic as a normal first-party app
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Allow mic/camera for this origin when framed by the same host
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self)");
  next();
});

app.use("/api", createApiRouter());
app.use(express.static(path.join(__dirname, "public"), {
  // Ensure module scripts are served with correct MIME behind proxies
  setHeaders(res, filePath) {
    if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) {
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    }
  },
}));

app.get("/script", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "script.html"));
});
app.get("/rehearse", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "rehearse.html"));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Server error" });
});

if (process.env.VERCEL !== "1") {
  // 0.0.0.0 so both 127.0.0.1 and tunnel agents can connect
  const host = process.env.HOST || "0.0.0.0";
  const server = app.listen(PORT, host, () => {
    console.log(`Crowdwork running at http://${host}:${PORT}`);
  });
  server.on("error", (err) => {
    console.error("[server] listen error:", err);
  });
}

// Keep the process alive on unexpected upstream SDK throws (still log loudly)
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

export default app;
