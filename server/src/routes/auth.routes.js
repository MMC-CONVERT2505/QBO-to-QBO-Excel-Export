import express from "express";
import { callback, login, status, logout } from "../controllers/auth.controller.js";

const router = express.Router();

router.get("/login", login);
router.get("/callback", callback);
router.get("/status", status);
router.post("/logout", logout);

export default router;
