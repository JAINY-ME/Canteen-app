const express = require("express");
const router = express.Router();
const db = require("../config/db");

// GET: List all advertisements
router.get("/list", async (req, res) => {
  try {
    const rows = await db.all("SELECT * FROM ads ORDER BY created_at DESC");
    res.json({ success: true, ads: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Add new advertisement banner
router.post("/add", async (req, res) => {
  const { title, image_url, description, discount_code, ad_type } = req.body;
  const staff_id = req.staff ? req.staff.staff_id : 1;

  if (!title)
    return res
      .status(400)
      .json({ success: false, error: "Ad title is required." });

  try {
    const result = await db.run(
      `INSERT INTO ads (title, image_url, description, discount_code, ad_type, is_active) VALUES (?, ?, ?, ?, ?, 1)`,
      [
        title,
        image_url ||
          "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=800",
        description || "",
        discount_code || "",
        ad_type || "Promo",
      ],
    );
    const newAdId = result.lastID;

    // Log manager action
    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id,
        "Add Ad",
        `Added new advertisement "${title}" (ID: ${newAdId})`,
      ],
    );

    res.json({
      success: true,
      message: "Advertisement added successfully.",
      ad_id: newAdId,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Toggle active status of an ad
router.post("/toggle/:id", async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body; // 1 or 0
  const staff_id = req.staff ? req.staff.staff_id : 1;

  try {
    const ad = await db.get("SELECT * FROM ads WHERE ad_id = ?", [id]);
    if (!ad)
      return res.status(404).json({ success: false, error: "Ad not found" });

    await db.run("UPDATE ads SET is_active = ? WHERE ad_id = ?", [
      is_active,
      id,
    ]);

    const actionText = is_active ? "Enabled" : "Disabled";
    // Log manager action
    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id,
        "Toggle Ad Status",
        `${actionText} advertisement "${ad.title}"`,
      ],
    );

    res.json({
      success: true,
      message: `Ad ${actionText.toLowerCase()} successfully.`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Delete advertisement banner
router.post("/delete/:id", async (req, res) => {
  const { id } = req.params;
  const staff_id = req.staff ? req.staff.staff_id : 1;

  try {
    const ad = await db.get("SELECT * FROM ads WHERE ad_id = ?", [id]);
    if (!ad)
      return res.status(404).json({ success: false, error: "Ad not found" });

    await db.run("DELETE FROM ads WHERE ad_id = ?", [id]);

    // Log manager action
    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      ["Staff", staff_id, "Delete Ad", `Deleted advertisement "${ad.title}"`],
    );

    res.json({ success: true, message: "Ad deleted successfully." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
