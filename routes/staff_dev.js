const express = require("express");
const router = express.Router();
const db = require("../config/db");
const bcrypt = require("bcryptjs");

// POST: Seed initial staff member roles
router.post("/seed-staff", async (req, res) => {
  try {
    // Seed Roles if missing
    const rolesCount = await db.get("SELECT COUNT(*) as count FROM roles");
    if (rolesCount.count === 0) {
      await db.run("INSERT INTO roles (role_name) VALUES ('Admin'), ('Manager'), ('Chef'), ('Accountant'), ('Cashier'), ('Event Manager')");
    }

    // Wipe staff accounts and seed defaults
    await db.run("DELETE FROM staff");
    await db.run("DELETE FROM sqlite_sequence WHERE name = 'staff'");

    const managerHash = await bcrypt.hash("manager123", 10);
    const chefHash = await bcrypt.hash("chef123", 10);
    const accountantHash = await bcrypt.hash("accountant123", 10);
    const cashierHash = await bcrypt.hash("cashier123", 10);
    const eventHash = await bcrypt.hash("event123", 10);

    await db.run(`
      INSERT INTO staff (role_id, canteen_id, full_name, email, phone, password_hash) VALUES 
      (2, NULL, 'System Manager', 'manager@canteen.com', '+919999999991', ?),
      (3, 1, 'Head Chef Main', 'chef@canteen.com', '+919999999992', ?),
      (4, 1, 'Chief Accountant Main', 'accountant@canteen.com', '+919999999993', ?),
      (5, 1, 'Main Canteen Cashier', 'cashier@canteen.com', '+919999999994', ?),
      (6, NULL, 'Event Coordinator', 'event@canteen.com', '+919999999995', ?)
    `, [managerHash, chefHash, accountantHash, cashierHash, eventHash]);

    res.json({ success: true, message: "Staff login accounts seeded! Logins: manager@canteen.com (pwd: manager123), chef@canteen.com (pwd: chef123), accountant@canteen.com (pwd: accountant123), cashier@canteen.com (pwd: cashier123)." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Seed default canteens & items catalog
router.post("/seed-catalog", async (req, res) => {
  try {
    await db.run("DELETE FROM item_supplies");
    await db.run("DELETE FROM items");
    await db.run("DELETE FROM categories");
    await db.run("DELETE FROM menus");
    await db.run("DELETE FROM canteens");
    await db.run("DELETE FROM inventory");

    const tablesToReset = ["items", "categories", "menus", "canteens", "inventory", "item_supplies"];
    for (const t of tablesToReset) {
      await db.run("DELETE FROM sqlite_sequence WHERE name = ?", [t]);
    }

    // Insert canteens
    await db.run(`
      INSERT INTO canteens (canteen_id, canteen_name, location, is_active) VALUES 
      (1, 'Main Canteen', 'Main Academic Building, Ground Floor', 1),
      (2, 'Library Cafe', 'Central Library Reading Hall, Level 1', 1)
    `);

    // Insert Sections
    await db.run(`
      INSERT INTO menus (menu_id, canteen_id, menu_name, is_active) VALUES 
      (1, 1, 'Snacks Section', 1),
      (2, 1, 'Beverages Section', 1),
      (3, 1, 'Meals Section', 1),
      (4, 2, 'Library Bakes & Cakes', 1),
      (5, 2, 'Library Coffee Bar', 1)
    `);

    // Insert Categories
    await db.run(`
      INSERT INTO categories (category_id, menu_id, category_name) VALUES 
      (1, 1, 'Burgers & Sandwiches'),
      (2, 1, 'Quick Snacks'),
      (3, 2, 'Hot Brews'),
      (4, 2, 'Cold Beverages'),
      (5, 3, 'Lunch Specials'),
      (6, 3, 'Combos'),
      (7, 4, 'Oven Fresh Cakes'),
      (8, 4, 'Pastries'),
      (9, 5, 'Espresso Drinks')
    `);

    // Insert Food Items
    await db.run(`
      INSERT INTO items (item_id, category_id, item_name, price, item_status, is_healthy, ingredients, image_url, discount_type, discount_value, gst_percentage) VALUES 
      (1, 1, 'Veg Masala Sandwich', 60.00, 'Available', 1, 'Bread, Potato, Butter, Mint Chutney', 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=500', 'Percentage', 10.0, 5.0),
      (2, 1, 'Paneer Burger', 80.00, 'Available', 0, 'Bun, Paneer Patty, Cheese, Onion, Sauce', 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500', 'None', 0.0, 5.0),
      (3, 2, 'Samosa (Plate of 2)', 30.00, 'Available', 0, 'Flour, Potato, Peas, Spices', 'https://images.unsplash.com/photo-1601050690597-df056fb4ce78?w=500', 'Fixed', 5.0, 5.0),
      (4, 3, 'Cardamom Masala Tea', 15.00, 'Available', 1, 'Milk, Tea Leaves, Cardamom, Ginger', 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=500', 'None', 0.0, 5.0),
      (5, 4, 'Cold Coffee with Ice Cream', 50.00, 'Available', 0, 'Milk, Coffee Powder, Sugar, Vanilla Ice Cream', 'https://images.unsplash.com/photo-1595981267035-7b04ca84a82d?w=500', 'Percentage', 20.0, 18.0),
      (6, 5, 'Special Paneer Thali', 120.00, 'Available', 1, 'Paneer Curry, Dal Fry, Jeera Rice, 3 Roti, Salad', 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500', 'None', 0.0, 5.0),
      (7, 7, 'Oven Baked Chocolate Muffin', 45.00, 'Available', 0, 'Flour, Cocoa Powder, Sugar, Choco chips', 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=500', 'None', 0.0, 18.0),
      (8, 8, 'Rich Chocolate Pastry Slice', 70.00, 'Available', 0, 'Sponge cake, Chocolate ganache, Cream', 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=500', 'None', 0.0, 18.0),
      (9, 9, 'Double Shot Espresso', 40.00, 'Available', 1, 'Fresh ground Arabica beans, Water', 'https://images.unsplash.com/photo-1510972527409-cef1b773eb3f?w=500', 'None', 0.0, 5.0)
    `);

    // Insert Inventory
    await db.run(`
      INSERT INTO inventory (supply_id, supply_name, quantity, unit, min_threshold) VALUES 
      (1, 'Bread Loaves', 50, 'packets', 10),
      (2, 'Potatoes', 100, 'kg', 20),
      (3, 'Paneer', 25, 'kg', 5),
      (4, 'Milk', 80, 'liters', 15),
      (5, 'Coffee Powder', 10, 'kg', 2),
      (6, 'Tea Leaves', 8, 'kg', 1.5),
      (7, 'Rice', 150, 'kg', 30),
      (8, 'Dal', 100, 'kg', 20)
    `);

    // Link Supplies
    await db.run(`
      INSERT INTO item_supplies (item_id, supply_id, quantity_required) VALUES 
      (1, 1, 0.05),
      (1, 2, 0.1),
      (3, 2, 0.15),
      (5, 4, 0.1),
      (5, 6, 0.01),
      (6, 4, 0.2),
      (6, 5, 0.02),
      (7, 3, 0.2),
      (7, 7, 0.2),
      (7, 8, 0.1)
    `);

    // Seed configurations
    await db.run("DELETE FROM settings WHERE key = 'student_discount_percentage'");
    await db.run("INSERT INTO settings (key, value) VALUES ('student_discount_percentage', '10')");

    res.json({ success: true, message: "Database catalog and settings seeded successfully!" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Generate 5 mock orders in various states
router.post("/generate-mock-orders", async (req, res) => {
  try {
    let customer = await db.get("SELECT * FROM customers WHERE phone = '9876543210'");
    if (!customer) {
      const insertCust = await db.run("INSERT INTO customers (full_name, phone, email, customer_category) VALUES ('Student Tester', '9876543210', 'tester@canteen.com', 'Student')");
      customer = { customer_id: insertCust.lastID, full_name: "Student Tester", customer_category: "Student" };
    }

    await db.run("DELETE FROM order_items");
    await db.run("DELETE FROM transactions");
    await db.run("DELETE FROM orders");
    await db.run("DELETE FROM sqlite_sequence WHERE name IN ('orders', 'order_items', 'transactions')");

    const itemsCount = await db.get("SELECT COUNT(*) as count FROM items");
    if (itemsCount.count === 0) {
      return res.status(400).json({ success: false, error: "Please seed catalog data first before generating mock orders." });
    }

    // Order 1: Cash Approval Pending
    const order1 = await db.run("INSERT INTO orders (customer_id, canteen_id, total_items, total_amount, order_status) VALUES (?, 1, 2, 120.00, 'AWAITING_CASH_APPROVAL')", [customer.customer_id]);
    await db.run("INSERT INTO order_items (order_id, item_id, quantity, unit_price, subtotal, prepared_status) VALUES (?, 1, 2, 60.00, 120.00, 'Pending')", [order1.lastID]);
    await db.run(`INSERT INTO transactions 
      (order_id, customer_id, total_item_amount, discount_amount, gst_amount, total_payable, payment_type, payment_status) 
      VALUES (?, ?, 120.00, 12.00, 5.40, 113.40, 'Cash', 'Awaiting Cashier')`, [order1.lastID, customer.customer_id]);

    // Order 2: Kitchen Cooking (Preparing)
    const order2 = await db.run("INSERT INTO orders (customer_id, canteen_id, total_items, total_amount, order_status) VALUES (?, 1, 1, 80.00, 'Preparing')", [customer.customer_id]);
    await db.run("INSERT INTO order_items (order_id, item_id, quantity, unit_price, subtotal, prepared_status) VALUES (?, 2, 1, 80.00, 80.00, 'Pending')", [order2.lastID]);
    await db.run(`INSERT INTO transactions 
      (order_id, customer_id, total_item_amount, discount_amount, gst_amount, total_payable, payment_type, payment_status) 
      VALUES (?, ?, 80.00, 8.00, 3.60, 75.60, 'UPI', 'Settled')`, [order2.lastID, customer.customer_id]);

    // Order 3: Ready for Pickup
    const order3 = await db.run("INSERT INTO orders (customer_id, canteen_id, total_items, total_amount, order_status) VALUES (?, 1, 1, 30.00, 'Prepared')", [customer.customer_id]);
    await db.run("INSERT INTO order_items (order_id, item_id, quantity, unit_price, subtotal, prepared_status) VALUES (?, 3, 1, 30.00, 30.00, 'Prepared')", [order3.lastID]);
    await db.run(`INSERT INTO transactions 
      (order_id, customer_id, total_item_amount, discount_amount, gst_amount, total_payable, payment_type, payment_status) 
      VALUES (?, ?, 30.00, 3.00, 1.35, 28.35, 'UPI', 'Settled')`, [order3.lastID, customer.customer_id]);

    // Order 4: Completed
    const order4 = await db.run("INSERT INTO orders (customer_id, canteen_id, total_items, total_amount, order_status) VALUES (?, 1, 2, 120.00, 'Completed')", [customer.customer_id]);
    await db.run("INSERT INTO order_items (order_id, item_id, quantity, unit_price, subtotal, prepared_status) VALUES (?, 1, 2, 60.00, 120.00, 'Prepared')", [order4.lastID]);
    await db.run(`INSERT INTO transactions 
      (order_id, customer_id, total_item_amount, discount_amount, gst_amount, total_payable, payment_type, payment_status) 
      VALUES (?, ?, 120.00, 12.00, 5.40, 113.40, 'Cash', 'Settled')`, [order4.lastID, customer.customer_id]);

    // Order 5: Cancelled
    const order5 = await db.run("INSERT INTO orders (customer_id, canteen_id, total_items, total_amount, order_status) VALUES (?, 1, 1, 60.00, 'Cancelled')", [customer.customer_id]);
    await db.run("INSERT INTO order_items (order_id, item_id, quantity, unit_price, subtotal, prepared_status) VALUES (?, 1, 1, 60.00, 60.00, 'Pending')", [order5.lastID]);
    await db.run(`INSERT INTO transactions 
      (order_id, customer_id, total_item_amount, discount_amount, gst_amount, total_payable, payment_type, payment_status) 
      VALUES (?, ?, 60.00, 6.00, 2.70, 56.70, 'UPI', 'Cancelled')`, [order5.lastID, customer.customer_id]);

    res.json({ success: true, message: "Successfully generated 5 diverse mock orders for Student Tester (9876543210)! Real-time Cooking KDS, cashier counters, and sales reports are populated." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Wipe transactions, logs, feedback, ratings
router.post("/wipe-db", async (req, res) => {
  try {
    await db.run("DELETE FROM order_items");
    await db.run("DELETE FROM transactions");
    await db.run("DELETE FROM orders");
    await db.run("DELETE FROM ratings");
    await db.run("DELETE FROM feedback");
    await db.run("DELETE FROM logs");

    const tables = ["orders", "order_items", "transactions", "ratings", "feedback", "logs"];
    for (const t of tables) {
      await db.run("DELETE FROM sqlite_sequence WHERE name = ?", [t]);
    }
    res.json({ success: true, message: "All transactions, kitchen orders, reviews, logs, and customer feedbacks wiped successfully!" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
