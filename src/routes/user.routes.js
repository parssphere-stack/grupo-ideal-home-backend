/**
 * User Auth & Favorites API
 *
 * POST /api/users/register            — create account
 * POST /api/users/login               — login, returns JWT
 * GET  /api/users/me                  — current user profile
 * PUT  /api/users/me                  — update profile
 * GET  /api/users/favorites           — list favorites (populated)
 * POST /api/users/favorites/:id       — add favorite
 * DELETE /api/users/favorites/:id     — remove favorite
 */

const express = require("express");
const router = express.Router();
const User = require("../models/user.model");
const { userAuth: auth, signUserToken } = require("../middleware/auth");

// ── Register ─────────────────────────────────────────────────
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, phone, favorites } =
      req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password required" });
    }

    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const user = new User({
      name,
      email,
      password,
      phone,
    });

    // Merge localStorage favorites if provided
    if (favorites && Array.isArray(favorites)) {
      user.favorites = [...new Set(favorites)];
    }

    await user.save();

    const token = signUserToken(user);

    res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    console.error("Register error:", err.message);
    res.status(500).json({ error: "Registration failed" });
  }
});

// ── Login ────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const user = await User.findOne({ email: email.toLowerCase(), active: true });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const valid = await user.comparePassword(password);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const token = signUserToken(user);

    res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: "Login failed" });
  }
});

// ── Get current user ─────────────────────────────────────────
router.get("/me", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// ── Update profile ───────────────────────────────────────────
router.put("/me", auth, async (req, res) => {
  try {
    const { name, phone } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { ...(name && { name }), ...(phone !== undefined && { phone }) },
      { new: true },
    ).select("-password");
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Update failed" });
  }
});

// ── List favorites ───────────────────────────────────────────
router.get("/favorites", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate({
      path: "favorites",
      select: "title price location images type operation features status",
    });
    res.json(user.favorites || []);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch favorites" });
  }
});

// ── Add favorite ─────────────────────────────────────────────
router.post("/favorites/:id", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user.favorites.includes(req.params.id)) {
      user.favorites.push(req.params.id);
      await user.save();
    }
    res.json({ ok: true, count: user.favorites.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to add favorite" });
  }
});

// ── Remove favorite ──────────────────────────────────────────
router.delete("/favorites/:id", auth, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, {
      $pull: { favorites: req.params.id },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to remove favorite" });
  }
});

module.exports = router;
