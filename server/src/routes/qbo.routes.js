import express from "express";
import { getCompanyInfo, getEntityData, getOpenBalanceDiagnostics, getItemDiagnostics, getInvoiceTaxCodeDiagnostics } from "../controllers/qbo.controller.js";
import { requireQboAuth } from "../middleware/requireQboAuth.js";

const router = express.Router();

router.use(requireQboAuth);

router.get("/company-info", getCompanyInfo);
router.get("/diagnostics/open-balance", getOpenBalanceDiagnostics);
router.get("/diagnostics/items", getItemDiagnostics);
router.get("/diagnostics/invoice-tax-codes", getInvoiceTaxCodeDiagnostics);

router.get("/accounts", (req, res, next) => { req.params.entityPlural = "accounts"; getEntityData(req, res, next); });
router.get("/customers", (req, res, next) => { req.params.entityPlural = "customers"; getEntityData(req, res, next); });
router.get("/vendors", (req, res, next) => { req.params.entityPlural = "vendors"; getEntityData(req, res, next); });
router.get("/items", (req, res, next) => { req.params.entityPlural = "items"; getEntityData(req, res, next); });
router.get("/ar", (req, res, next) => { req.params.entityPlural = "ar"; getEntityData(req, res, next); });
router.get("/ap", (req, res, next) => { req.params.entityPlural = "ap"; getEntityData(req, res, next); });

export default router;
