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

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use("/api", createApiRouter());
app.use(express.static(path.join(__dirname, "public")));

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
  app.listen(PORT, () => {
    console.log(`Crowdwork running at http://localhost:${PORT}`);
  });
}

export default app;
