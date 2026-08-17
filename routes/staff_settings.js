const express = require("express");
const router = express.Router();
const db = require("../config/db");

// GET: Fetch all configurations/settings
router.get("/all", async (req, res) => {
  try {
    const rows = await db.all("SELECT * FROM settings");
    res.json({ success: true, settings: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Update specific setting key-value pair
router.post("/update", async (req, res) => {
  const { key, value } = req.body;
  const staff_id = req.staff ? req.staff.staff_id : 1;
  if (!key || value === undefined) {
    return res
      .status(400)
      .json({ success: false, error: "Key and Value are required." });
  }

  try {
    const oldSetting = await db.get("SELECT * FROM settings WHERE key = ?", [
      key,
    ]);
    await db.run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value.toString()],
    );

    // Audit log action
    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id,
        "Update Configuration",
        `Changed configuration "${key}" from "${oldSetting ? oldSetting.value : "none"}" -> "${value}"`,
      ],
    );

    res.json({
      success: true,
      message: `Configuration "${key}" updated successfully.`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
