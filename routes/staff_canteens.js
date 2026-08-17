const express = require("express");
const router = express.Router();
const db = require("../config/db");

// GET: Fetch all canteens
router.get("/all", async (req, res) => {
  try {
    const rows = await db.all("SELECT * FROM canteens ORDER BY canteen_id ASC");
    res.json({ success: true, canteens: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Add new canteen location
router.post("/add", async (req, res) => {
  const { canteen_name, location, is_active } = req.body;
  const staff_id = req.staff ? req.staff.staff_id : 1;
  if (!canteen_name) {
    return res
      .status(400)
      .json({ success: false, error: "Canteen name is required." });
  }

  try {
    const result = await db.run(
      "INSERT INTO canteens (canteen_name, location, is_active) VALUES (?, ?, ?)",
      [
        canteen_name,
        location || "",
        is_active !== undefined ? parseInt(is_active) : 1,
      ],
    );

    // Log manager action
    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id,
        "Add Canteen",
        `Created canteen location "${canteen_name}" (ID: ${result.lastID})`,
      ],
    );

    res.json({
      success: true,
      message: "Canteen added successfully.",
      canteen_id: result.lastID,
    });
  } catch (err) {
    if (err.message.includes("UNIQUE")) {
      return res
        .status(400)
        .json({
          success: false,
          error: "A canteen with this name already exists.",
        });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Edit canteen location
router.post("/edit/:id", async (req, res) => {
  const canteenId = parseInt(req.params.id);
  const { canteen_name, location, is_active } = req.body;
  const staff_id = req.staff ? req.staff.staff_id : 1;

  if (!canteen_name) {
    return res
      .status(400)
      .json({ success: false, error: "Canteen name is required." });
  }

  try {
    await db.run(
      "UPDATE canteens SET canteen_name = ?, location = ?, is_active = ? WHERE canteen_id = ?",
      [
        canteen_name,
        location || "",
        is_active !== undefined ? parseInt(is_active) : 1,
        canteenId,
      ],
    );

    // Log manager action
    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id,
        "Edit Canteen",
        `Updated canteen ID ${canteenId} details`,
      ],
    );

    res.json({ success: true, message: "Canteen updated successfully." });
  } catch (err) {
    if (err.message.includes("UNIQUE")) {
      return res
        .status(400)
        .json({
          success: false,
          error: "A canteen with this name already exists.",
        });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Delete canteen location
router.post("/delete/:id", async (req, res) => {
  const canteenId = parseInt(req.params.id);
  const staff_id = req.staff ? req.staff.staff_id : 1;

  try {
    await db.run("DELETE FROM canteens WHERE canteen_id = ?", [canteenId]);

    // Log manager action
    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      ["Staff", staff_id, "Delete Canteen", `Deleted canteen ID ${canteenId}`],
    );

    res.json({ success: true, message: "Canteen deleted successfully." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
