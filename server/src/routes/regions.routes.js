import express from "express";
import { getRegions, getRegionTemplates } from "../controllers/regions.controller.js";

const router = express.Router();

router.get("/regions", getRegions);
router.get("/templates/:region", getRegionTemplates);

export default router;
