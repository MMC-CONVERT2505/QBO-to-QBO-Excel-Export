import express from "express";
import { getTaxMapping, saveTaxMapping } from "../controllers/taxMapping.controller.js";
import { requireQboAuth } from "../middleware/requireQboAuth.js";

const router = express.Router();

router.use(requireQboAuth);

router.get("/", getTaxMapping);
router.put("/", saveTaxMapping);

export default router;
