const express = require("express");
const router = express.Router();
const db = require("../config/db");

// GET: List all items (with category, menu section, and rating details)
router.get("/list", async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT i.*, c.category_name, m.menu_name, m.menu_id,
                    COALESCE(AVG(rat.rating), 0) as avg_rating,
                    COUNT(rat.rating) as rating_count
             FROM items i 
             LEFT JOIN categories c ON i.category_id = c.category_id
             LEFT JOIN menus m ON c.menu_id = m.menu_id
             LEFT JOIN ratings rat ON i.item_id = rat.item_id
             GROUP BY i.item_id
             ORDER BY m.menu_id, c.category_id, i.item_name`,
    );

    // Fetch categories to populate selectors in the frontend
    const categories = await db.all(
      `SELECT c.*, m.menu_name 
             FROM categories c 
             JOIN menus m ON c.menu_id = m.menu_id`,
    );

    res.json({ success: true, items: rows, categories });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET: Fetch feedbacks/reviews for a specific item
router.get("/ratings/:itemId", async (req, res) => {
  const { itemId } = req.params;
  try {
    const rows = await db.all(
      `SELECT r.*, cust.full_name as customer_name 
             FROM ratings r
             LEFT JOIN customers cust ON r.customer_id = cust.customer_id
             WHERE r.item_id = ?
             ORDER BY r.created_at DESC`,
      [itemId],
    );
    res.json({ success: true, reviews: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Add new food item
router.post("/add", async (req, res) => {
  const {
    category_id,
    item_name,
    price,
    is_healthy,
    ingredients,
    image_url,
    discount_type,
    discount_value,
    gst_percentage,
  } = req.body;
  const staff_id = req.staff ? req.staff.staff_id : 1;

  if (!item_name || !price || !category_id) {
    return res.status(400).json({
      success: false,
      error: "Item name, category and price are required",
    });
  }

  try {
    const result = await db.run(
      `INSERT INTO items 
             (category_id, item_name, price, item_status, is_healthy, ingredients, image_url, discount_type, discount_value, gst_percentage)
             VALUES (?, ?, ?, 'Available', ?, ?, ?, ?, ?, ?)`,
      [
        category_id,
        item_name,
        price,
        is_healthy ? 1 : 0,
        ingredients || "",
        image_url ||
          "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500",
        discount_type || "None",
        discount_value || 0.0,
        gst_percentage !== undefined ? parseFloat(gst_percentage) : 5.0,
      ],
    );
    const newItemId = result.lastID;

    // Log manager action
    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id || 1,
        "Add Item",
        `Added food item "${item_name}" (ID: ${newItemId}) at price Rs. ${price} with GST ${gst_percentage}%`,
      ],
    );

    res.json({
      success: true,
      message: "Item added successfully.",
      item_id: newItemId,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Update existing food item
router.post("/edit/:id", async (req, res) => {
  const { id } = req.params;
  const {
    category_id,
    item_name,
    price,
    is_healthy,
    ingredients,
    image_url,
    discount_type,
    discount_value,
    gst_percentage,
    item_status,
  } = req.body;
  const staff_id = req.staff ? req.staff.staff_id : 1;

  try {
    const oldItem = await db.get("SELECT * FROM items WHERE item_id = ?", [id]);
    if (!oldItem)
      return res.status(404).json({ success: false, error: "Item not found" });

    await db.run(
      `UPDATE items 
             SET category_id = ?, 
                 item_name = ?, 
                 price = ?, 
                 is_healthy = ?, 
                 ingredients = ?, 
                 image_url = ?, 
                 discount_type = ?, 
                 discount_value = ?,
                 gst_percentage = ?,
                 item_status = ?,
                 updated_at = datetime('now','localtime')
             WHERE item_id = ?`,
      [
        category_id,
        item_name,
        price,
        is_healthy ? 1 : 0,
        ingredients || "",
        image_url || oldItem.image_url,
        discount_type || "None",
        discount_value || 0.0,
        gst_percentage !== undefined ? parseFloat(gst_percentage) : 5.0,
        item_status || oldItem.item_status,
        id,
      ],
    );

    // Compute modifications for logging
    let changes = [];
    if (oldItem.item_name !== item_name)
      changes.push(`Name changed: "${oldItem.item_name}" -> "${item_name}"`);
    if (oldItem.price !== parseFloat(price))
      changes.push(`Price: ${oldItem.price} -> ${price}`);
    if (oldItem.gst_percentage !== parseFloat(gst_percentage))
      changes.push(`GST: ${oldItem.gst_percentage} -> ${gst_percentage}`);
    if (
      oldItem.discount_type !== discount_type ||
      oldItem.discount_value !== parseFloat(discount_value)
    ) {
      changes.push(
        `Discount: ${oldItem.discount_type} (${oldItem.discount_value}) -> ${discount_type} (${discount_value})`,
      );
    }

    const changeStr =
      changes.length > 0
        ? changes.join(", ")
        : "No pricing or naming details changed";

    // Log manager action
    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id || 1,
        "Edit Item",
        `Edited food item "${item_name}" (ID: ${id}). ${changeStr}`,
      ],
    );

    res.json({ success: true, message: "Item updated successfully." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Toggle Item Status (Quick toggle for availability)
router.post("/toggle-status/:id", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'Available' or 'Out of Stock'
  const staff_id = req.staff ? req.staff.staff_id : 1;

  try {
    const item = await db.get("SELECT * FROM items WHERE item_id = ?", [id]);
    if (!item)
      return res.status(404).json({ success: false, error: "Item not found" });

    await db.run("UPDATE items SET item_status = ? WHERE item_id = ?", [
      status,
      id,
    ]);

    // Log action
    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id || 1,
        "Toggle Item Status",
        `Changed "${item.item_name}" availability to "${status}"`,
      ],
    );

    res.json({ success: true, message: `Status updated to ${status}.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Delete food item
router.post("/delete/:id", async (req, res) => {
  const { id } = req.params;
  const staff_id = req.staff ? req.staff.staff_id : 1;

  try {
    const item = await db.get("SELECT * FROM items WHERE item_id = ?", [id]);
    if (!item)
      return res.status(404).json({ success: false, error: "Item not found" });

    // Delete dependencies first
    await db.run("DELETE FROM item_supplies WHERE item_id = ?", [id]);
    await db.run("DELETE FROM items WHERE item_id = ?", [id]);

    // Log action
    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id || 1,
        "Delete Item",
        `Deleted food item "${item.item_name}" (ID: ${id})`,
      ],
    );

    res.json({ success: true, message: "Item deleted successfully." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// ==========================================
// CANTEEN SECTIONS (MENUS) MANAGEMENT
// ==========================================

// GET: Fetch all canteen sections (menus)
router.get("/menus/all", async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT m.*, c.canteen_name 
             FROM menus m 
             LEFT JOIN canteens c ON m.canteen_id = c.canteen_id
             ORDER BY m.menu_id ASC`,
    );
    res.json({ success: true, menus: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Add new Canteen Section
router.post("/menus/add", async (req, res) => {
  const { menu_name, is_active, canteen_id } = req.body;
  const staff_id = req.staff ? req.staff.staff_id : 1;
  if (!menu_name)
    return res
      .status(400)
      .json({ success: false, error: "Canteen Section name is required." });

  try {
    const result = await db.run(
      "INSERT INTO menus (menu_name, is_active, canteen_id) VALUES (?, ?, ?)",
      [
        menu_name,
        is_active === undefined ? 1 : is_active,
        canteen_id ? parseInt(canteen_id) : null,
      ],
    );
    const newMenuId = result.lastID;

    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id || 1,
        "Add Section",
        `Created Canteen Section "${menu_name}" (ID: ${newMenuId}) for Canteen ID: ${canteen_id}`,
      ],
    );

    res.json({
      success: true,
      message: "Canteen Section created.",
      menu_id: newMenuId,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Edit Canteen Section
router.post("/menus/edit/:id", async (req, res) => {
  const { id } = req.params;
  const { menu_name, is_active, canteen_id } = req.body;
  const staff_id = req.staff ? req.staff.staff_id : 1;

  try {
    const oldMenu = await db.get("SELECT * FROM menus WHERE menu_id = ?", [id]);
    if (!oldMenu)
      return res
        .status(404)
        .json({ success: false, error: "Section not found." });

    await db.run(
      "UPDATE menus SET menu_name = ?, is_active = ?, canteen_id = ? WHERE menu_id = ?",
      [menu_name, is_active, canteen_id ? parseInt(canteen_id) : null, id],
    );

    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id || 1,
        "Edit Section",
        `Updated Canteen Section "${oldMenu.menu_name}" -> "${menu_name}" (Canteen: ${canteen_id})`,
      ],
    );

    res.json({ success: true, message: "Canteen Section updated." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Delete Canteen Section
router.post("/menus/delete/:id", async (req, res) => {
  const { id } = req.params;
  const staff_id = req.staff ? req.staff.staff_id : 1;

  try {
    const menu = await db.get("SELECT * FROM menus WHERE menu_id = ?", [id]);
    if (!menu)
      return res
        .status(404)
        .json({ success: false, error: "Section not found." });

    await db.run("DELETE FROM menus WHERE menu_id = ?", [id]);

    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id || 1,
        "Delete Section",
        `Deleted Canteen Section "${menu.menu_name}" (ID: ${id})`,
      ],
    );

    res.json({ success: true, message: "Canteen Section deleted." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// FOOD CATEGORIES MANAGEMENT
// ==========================================

// GET: Fetch all food categories
router.get("/categories/all", async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT c.*, m.menu_name 
             FROM categories c
             JOIN menus m ON c.menu_id = m.menu_id
             ORDER BY c.menu_id ASC, c.category_name ASC`,
    );
    res.json({ success: true, categories: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Add new Category
router.post("/categories/add", async (req, res) => {
  const { category_name, menu_id } = req.body;
  const staff_id = req.staff ? req.staff.staff_id : 1;
  if (!category_name || !menu_id) {
    return res.status(400).json({
      success: false,
      error: "Category name and Canteen Section are required.",
    });
  }

  try {
    const menu = await db.get("SELECT * FROM menus WHERE menu_id = ?", [
      menu_id,
    ]);
    if (!menu)
      return res
        .status(404)
        .json({ success: false, error: "Canteen Section not found." });

    const result = await db.run(
      "INSERT INTO categories (menu_id, category_name) VALUES (?, ?)",
      [menu_id, category_name],
    );
    const newCatId = result.lastID;

    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id || 1,
        "Add Category",
        `Created Category "${category_name}" in Section "${menu.menu_name}"`,
      ],
    );

    res.json({
      success: true,
      message: "Category created.",
      category_id: newCatId,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Edit Category
router.post("/categories/edit/:id", async (req, res) => {
  const { id } = req.params;
  const { category_name, menu_id } = req.body;
  const staff_id = req.staff ? req.staff.staff_id : 1;

  try {
    const oldCat = await db.get(
      "SELECT * FROM categories WHERE category_id = ?",
      [id],
    );
    if (!oldCat)
      return res
        .status(404)
        .json({ success: false, error: "Category not found." });

    const menu = await db.get("SELECT * FROM menus WHERE menu_id = ?", [
      menu_id,
    ]);
    if (!menu)
      return res
        .status(404)
        .json({ success: false, error: "Canteen Section not found." });

    await db.run(
      "UPDATE categories SET category_name = ?, menu_id = ? WHERE category_id = ?",
      [category_name, menu_id, id],
    );

    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id || 1,
        "Edit Category",
        `Updated Category "${oldCat.category_name}" -> "${category_name}" under Section "${menu.menu_name}"`,
      ],
    );

    res.json({ success: true, message: "Category updated." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Delete Category
router.post("/categories/delete/:id", async (req, res) => {
  const { id } = req.params;
  const staff_id = req.staff ? req.staff.staff_id : 1;

  try {
    const cat = await db.get("SELECT * FROM categories WHERE category_id = ?", [
      id,
    ]);
    if (!cat)
      return res
        .status(404)
        .json({ success: false, error: "Category not found." });

    await db.run("DELETE FROM categories WHERE category_id = ?", [id]);

    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id || 1,
        "Delete Category",
        `Deleted Category "${cat.category_name}" (ID: ${id})`,
      ],
    );

    res.json({ success: true, message: "Category deleted." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
