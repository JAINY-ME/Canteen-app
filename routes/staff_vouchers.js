const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const db = require("../config/db");

// GET: Fetch all generated vouchers (including details of used customers and canteens)
router.get("/list", async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT v.*, c.full_name as customer_name, cant.canteen_name 
             FROM vouchers v
             LEFT JOIN customers c ON v.used_by_customer_id = c.customer_id
             LEFT JOIN canteens cant ON v.canteen_id = cant.canteen_id
             ORDER BY v.created_at DESC`,
    );
    res.json({ success: true, vouchers: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Bulk generate unique vouchers
router.post("/generate", async (req, res) => {
  const {
    prefix,
    count,
    discount_type,
    discount_value,
    canteen_id,
    expiry_date,
  } = req.body;
  const staff_id = req.staff ? req.staff.staff_id : 1;
  if (!prefix || !count || !discount_type || discount_value === undefined) {
    return res
      .status(400)
      .json({
        success: false,
        error: "Prefix, count, discount type, and value are required.",
      });
  }

  try {
    await db.run("BEGIN TRANSACTION");
    const generatedCodes = [];
    for (let i = 0; i < parseInt(count); i++) {
      // Generate a random, cryptographically secure 8-digit unique number
      const randomNum = crypto.randomInt(10000000, 99999999);
      const code = `${prefix.trim().toUpperCase()}-${randomNum}`;

      await db.run(
        `INSERT INTO vouchers (voucher_code, discount_type, discount_value, canteen_id, expiry_date, is_used) 
                 VALUES (?, ?, ?, ?, ?, 0)`,
        [
          code,
          discount_type,
          parseFloat(discount_value),
          canteen_id ? parseInt(canteen_id) : null,
          expiry_date || null,
        ],
      );
      generatedCodes.push(code);
    }
    await db.run("COMMIT");

    // Log manager action
    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id,
        "Generate Vouchers",
        `Generated ${count} single-use vouchers (Type: ${discount_type}, Value: ${discount_value}, Expiry: ${expiry_date || "None"}) with prefix "${prefix}"`,
      ],
    );

    res.json({
      success: true,
      message: `Generated ${count} unique vouchers successfully.`,
      codes: generatedCodes,
    });
  } catch (err) {
    await db.run("ROLLBACK");
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Delete specific voucher
router.post("/delete/:code", async (req, res) => {
  const { code } = req.params;
  const staff_id = req.staff ? req.staff.staff_id : 1;

  try {
    const voucher = await db.get(
      "SELECT * FROM vouchers WHERE voucher_code = ?",
      [code],
    );
    if (!voucher)
      return res
        .status(404)
        .json({ success: false, error: "Voucher not found." });
    if (voucher.is_used === 1)
      return res
        .status(400)
        .json({
          success: false,
          error: "Cannot delete a voucher that has already been used.",
        });

    await db.run("DELETE FROM vouchers WHERE voucher_code = ?", [code]);

    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      ["Staff", staff_id, "Delete Voucher", `Deleted unused voucher "${code}"`],
    );

    res.json({ success: true, message: "Voucher deleted successfully." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
