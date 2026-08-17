const express = require("express");
const router = express.Router();
const db = require("../config/db");

// GET: List all inventory supplies with low-stock warnings
router.get("/list", async (req, res) => {
  try {
    const rows = await db.all(
      "SELECT * FROM inventory ORDER BY supply_name ASC",
    );
    res.json({ success: true, inventory: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Add new supply ingredient
router.post("/add-supply", async (req, res) => {
  const { supply_name, quantity, unit, min_threshold } = req.body;
  const staff_id = req.staff ? req.staff.staff_id : 2;

  if (
    !supply_name ||
    quantity === undefined ||
    !unit ||
    min_threshold === undefined
  ) {
    return res
      .status(400)
      .json({ success: false, error: "All fields are required" });
  }

  try {
    const result = await db.run(
      `INSERT INTO inventory (supply_name, quantity, unit, min_threshold) VALUES (?, ?, ?, ?)`,
      [supply_name, quantity, unit, min_threshold],
    );
    const supplyId = result.lastID;

    // Log Chef action
    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id,
        "Add Supply",
        `Added supply "${supply_name}" (${quantity} ${unit}) to inventory.`,
      ],
    );

    res.json({
      success: true,
      message: "Supply added to inventory.",
      supply_id: supplyId,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Update supply quantity (restocking or manually adjusting)
router.post("/update-supply", async (req, res) => {
  const { supply_id, quantity, mode } = req.body; // mode: 'set' or 'add'
  const staff_id = req.staff ? req.staff.staff_id : 2;

  try {
    const oldSupply = await db.get(
      "SELECT * FROM inventory WHERE supply_id = ?",
      [supply_id],
    );
    if (!oldSupply)
      return res
        .status(404)
        .json({ success: false, error: "Supply not found" });

    let newQty = parseFloat(quantity);
    if (mode === "add") {
      newQty = oldSupply.quantity + newQty;
    }

    await db.run(
      `UPDATE inventory SET quantity = ?, updated_at = datetime('now','localtime') WHERE supply_id = ?`,
      [newQty, supply_id],
    );

    // Log action
    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id,
        "Update Inventory",
        `Updated supply "${oldSupply.supply_name}" stock from ${oldSupply.quantity} to ${newQty} ${oldSupply.unit}`,
      ],
    );

    res.json({ success: true, message: "Stock updated successfully." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Set warning threshold for a supply
router.post("/set-threshold", async (req, res) => {
  const { supply_id, min_threshold } = req.body;
  const staff_id = req.staff ? req.staff.staff_id : 2;

  try {
    const oldSupply = await db.get(
      "SELECT * FROM inventory WHERE supply_id = ?",
      [supply_id],
    );
    if (!oldSupply)
      return res
        .status(404)
        .json({ success: false, error: "Supply not found" });

    await db.run("UPDATE inventory SET min_threshold = ? WHERE supply_id = ?", [
      min_threshold,
      supply_id,
    ]);

    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id,
        "Update Threshold",
        `Changed warning threshold of "${oldSupply.supply_name}" from ${oldSupply.min_threshold} to ${min_threshold}`,
      ],
    );

    res.json({ success: true, message: "Threshold updated successfully." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET: Fetch supplies with low stock levels
router.get("/low-stock", async (req, res) => {
  try {
    const rows = await db.all(
      "SELECT * FROM inventory WHERE quantity < min_threshold",
    );
    res.json({ success: true, low_stock: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET: Fetch ingredients/supplies mapped to a specific food item
router.get("/item-supplies/:itemId", async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT its.*, inv.supply_name, inv.unit 
             FROM item_supplies its
             JOIN inventory inv ON its.supply_id = inv.supply_id
             WHERE its.item_id = ?`,
      [req.params.itemId],
    );
    res.json({ success: true, ingredients: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Save/map ingredients and quantities required for a food item
router.post("/save-item-supplies", async (req, res) => {
  const { item_id, ingredients } = req.body; // ingredients is array: [{ supply_id, quantity_required }]
  const staff_id = req.staff ? req.staff.staff_id : 2;

  try {
    const item = await db.get("SELECT * FROM items WHERE item_id = ?", [
      item_id,
    ]);
    if (!item)
      return res.status(404).json({ success: false, error: "Item not found" });

    await db.run("BEGIN TRANSACTION");

    // Remove existing mapping first
    await db.run("DELETE FROM item_supplies WHERE item_id = ?", [item_id]);

    // Insert new mappings
    for (const ing of ingredients) {
      await db.run(
        `INSERT INTO item_supplies (item_id, supply_id, quantity_required) VALUES (?, ?, ?)`,
        [item_id, ing.supply_id, ing.quantity_required],
      );
    }

    await db.run("COMMIT");

    // Log Chef action
    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id,
        "Map Ingredients",
        `Mapped ${ingredients.length} ingredients/supplies to item "${item.item_name}"`,
      ],
    );

    res.json({
      success: true,
      message: "Item ingredient mapping saved successfully.",
    });
  } catch (err) {
    await db.run("ROLLBACK");
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
