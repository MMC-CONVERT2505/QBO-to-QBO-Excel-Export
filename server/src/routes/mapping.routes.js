import express from "express";
import { previewMapping } from "../controllers/mapping.controller.js";
import { requireQboAuth } from "../middleware/requireQboAuth.js";

const router = express.Router();

router.post("/preview", requireQboAuth, previewMapping);

export default router;
