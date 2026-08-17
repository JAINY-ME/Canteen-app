const express = require("express");
const router = express.Router();
const db = require("../config/db");

// Fetch active menus (sections/restaurants)
router.get("/list", async (req, res) => {
  try {
    const canteenId = req.query.canteen_id;
    let sql = `SELECT * FROM menus WHERE is_active = 1`;
    const params = [];

    if (canteenId) {
      sql += ` AND canteen_id = ?`;
      params.push(parseInt(canteenId));
    }

    const rows = await db.all(sql, params);
    res.json({ success: true, menus: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fetch items for a specific menu, calculating final price based on item discounts
router.get("/items/:menuId", async (req, res) => {
  try {
    const { menuId } = req.params;
    const rows = await db.all(
      `SELECT i.*, c.category_name,
                    COALESCE(AVG(r.rating), 0) as avg_rating,
                    COUNT(r.rating) as rating_count
             FROM items i 
             JOIN categories c ON i.category_id = c.category_id
             LEFT JOIN ratings r ON i.item_id = r.item_id
             WHERE c.menu_id = ? AND i.item_status = 'Available'
             GROUP BY i.item_id`,
      [menuId],
    );

    // Process item pricing, applying item-specific discounts
    const items = rows.map((item) => {
      let finalPrice = item.price;
      if (item.discount_type === "Percentage") {
        finalPrice = Math.max(0, item.price * (1 - item.discount_value / 100));
      } else if (item.discount_type === "Fixed") {
        finalPrice = Math.max(0, item.price - item.discount_value);
      }
      return {
        ...item,
        discounted_price: parseFloat(finalPrice.toFixed(2)),
      };
    });

    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
