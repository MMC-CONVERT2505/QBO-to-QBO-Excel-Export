import express from "express";
import { startExport, getExportStatus, downloadExport } from "../controllers/export.controller.js";
import { requireQboAuth } from "../middleware/requireQboAuth.js";

const router = express.Router();

router.post("/", requireQboAuth, startExport);
router.get("/:jobId/status", getExportStatus);
router.get("/:jobId/download", downloadExport);

export default router;
