const express = require("express");
const router = express.Router();
const Contact = require("../models/contact.model");

// POST /api/contact — save contact form submission
router.post("/", async (req, res) => {
  try {
    const { name, email, phone, message, source } = req.body;

    if (!name || !email || !message) {
      return res
        .status(400)
        .json({ error: "Name, email, and message are required" });
    }

    const contact = await Contact.create({
      name,
      email,
      phone,
      message,
      source: source || "website",
    });

    res.status(201).json({ ok: true, id: contact._id });
  } catch (err) {
    console.error("Contact form error:", err.message);
    res.status(500).json({ error: "Failed to submit contact form" });
  }
});

// GET /api/contact — list submissions (for admin)
router.get("/", async (req, res) => {
  try {
    const contacts = await Contact.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json(contacts);
  } catch (err) {
    console.error("Contact list error:", err.message);
    res.status(500).json({ error: "Failed to fetch contacts" });
  }
});

module.exports = router;
