const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, "..", "canteen.db");
const db = new sqlite3.Database(dbPath);

// Promisified DB helpers
const dbQuery = {
  run: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  },
  get: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  all: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },
  exec: (sql) => {
    return new Promise((resolve, reject) => {
      db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  },
};

// Initialize DB and optimize for high throughput (70,000+ records per day)
async function initDB() {
  try {
    // Optimize SQLite performance
    await dbQuery.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA temp_store = MEMORY;
            PRAGMA foreign_keys = ON;
        `);

    // Create triggers to ensure created timestamps use localtime (fixes UTC vs local issues)
    await dbQuery.exec(`
          CREATE TRIGGER IF NOT EXISTS trg_logs_localtime AFTER INSERT ON logs
          BEGIN
            UPDATE logs SET timestamp = datetime('now','localtime') WHERE log_id = NEW.log_id;
          END;

          CREATE TRIGGER IF NOT EXISTS trg_orders_localtime AFTER INSERT ON orders
          BEGIN
            UPDATE orders SET created_at = datetime('now','localtime') WHERE order_id = NEW.order_id;
          END;

          CREATE TRIGGER IF NOT EXISTS trg_transactions_localtime AFTER INSERT ON transactions
          BEGIN
            UPDATE transactions SET created_at = datetime('now','localtime') WHERE transaction_id = NEW.transaction_id;
          END;

          CREATE TRIGGER IF NOT EXISTS trg_notifications_localtime AFTER INSERT ON notifications
          BEGIN
            UPDATE notifications SET created_at = datetime('now','localtime') WHERE notification_id = NEW.notification_id;
          END;

          CREATE TRIGGER IF NOT EXISTS trg_customers_localtime AFTER INSERT ON customers
          BEGIN
            UPDATE customers SET created_at = datetime('now','localtime') WHERE customer_id = NEW.customer_id;
          END;

          CREATE TRIGGER IF NOT EXISTS trg_items_localtime AFTER INSERT ON items
          BEGIN
            UPDATE items SET created_at = datetime('now','localtime') WHERE item_id = NEW.item_id;
          END;
        `);

    // Canteens location table
    await dbQuery.exec(`
            CREATE TABLE IF NOT EXISTS canteens (
                canteen_id INTEGER PRIMARY KEY AUTOINCREMENT,
                canteen_name TEXT NOT NULL UNIQUE,
                location TEXT,
                is_active INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

    // Settings (configurations) table
    await dbQuery.exec(`
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);

    // Vouchers table
    await dbQuery.exec(`
            CREATE TABLE IF NOT EXISTS vouchers (
                voucher_code TEXT PRIMARY KEY,
                discount_type TEXT NOT NULL, -- 'Percentage', 'Fixed', 'FreeMeal'
                discount_value REAL NOT NULL,
                is_used INTEGER DEFAULT 0,
                used_by_customer_id INTEGER,
                canteen_id INTEGER, -- NULL means applicable to all canteens
                expiry_date TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (used_by_customer_id) REFERENCES customers(customer_id) ON DELETE SET NULL,
                FOREIGN KEY (canteen_id) REFERENCES canteens(canteen_id) ON DELETE SET NULL
            );
        `);

    // Roles
    await dbQuery.exec(`
            CREATE TABLE IF NOT EXISTS roles (
                role_id INTEGER PRIMARY KEY AUTOINCREMENT,
                role_name TEXT NOT NULL UNIQUE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

    // Customers
    await dbQuery.exec(`
            CREATE TABLE IF NOT EXISTS customers (
                customer_id INTEGER PRIMARY KEY AUTOINCREMENT,
                full_name TEXT NOT NULL,
                phone TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                customer_category TEXT DEFAULT 'Student',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

    // Staff (with Canteen Assignment)
    await dbQuery.exec(`
            CREATE TABLE IF NOT EXISTS staff (
                staff_id INTEGER PRIMARY KEY AUTOINCREMENT,
                role_id INTEGER NOT NULL,
                canteen_id INTEGER,
                full_name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                phone TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                status TEXT DEFAULT 'Active',
                last_login DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (role_id) REFERENCES roles(role_id),
                FOREIGN KEY (canteen_id) REFERENCES canteens(canteen_id) ON DELETE SET NULL
            );
        `);

    // Menus (Canteen Sections/Restaurants - with Canteen Assignment)
    await dbQuery.exec(`
            CREATE TABLE IF NOT EXISTS menus (
                menu_id INTEGER PRIMARY KEY AUTOINCREMENT,
                canteen_id INTEGER,
                menu_name TEXT NOT NULL UNIQUE,
                is_active INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (canteen_id) REFERENCES canteens(canteen_id) ON DELETE CASCADE
            );
        `);

    // Categories
    await dbQuery.exec(`
            CREATE TABLE IF NOT EXISTS categories (
                category_id INTEGER PRIMARY KEY AUTOINCREMENT,
                menu_id INTEGER NOT NULL,
                category_name TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (menu_id) REFERENCES menus(menu_id)
            );
        `);

    // Food Items (with customizable GST percentage)
    await dbQuery.exec(`
            CREATE TABLE IF NOT EXISTS items (
                item_id INTEGER PRIMARY KEY AUTOINCREMENT,
                category_id INTEGER,
                item_name TEXT NOT NULL,
                price REAL NOT NULL,
                item_status TEXT DEFAULT 'Available',
                is_healthy INTEGER DEFAULT 0,
                ingredients TEXT,
                image_url TEXT,
                discount_type TEXT DEFAULT 'None',
                discount_value REAL DEFAULT 0.0,
                gst_percentage REAL DEFAULT 5.0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (category_id) REFERENCES categories(category_id) ON DELETE SET NULL
            );
        `);

    // Orders (linked to specific canteen)
    await dbQuery.exec(`
            CREATE TABLE IF NOT EXISTS orders (
                order_id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL,
                canteen_id INTEGER,
                total_items INTEGER NOT NULL,
                total_amount REAL NOT NULL,
                order_status TEXT DEFAULT 'Pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE,
                FOREIGN KEY (canteen_id) REFERENCES canteens(canteen_id) ON DELETE CASCADE
            );
        `);

    // Order Items
    await dbQuery.exec(`
            CREATE TABLE IF NOT EXISTS order_items (
                order_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL,
                item_id INTEGER NOT NULL,
                quantity INTEGER NOT NULL,
                unit_price REAL NOT NULL,
                subtotal REAL NOT NULL,
                prepared_status TEXT DEFAULT 'Pending',
                FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
                FOREIGN KEY (item_id) REFERENCES items(item_id) ON DELETE CASCADE
            );
        `);

    // Transactions (incorporating voucher details)
    await dbQuery.exec(`
            CREATE TABLE IF NOT EXISTS transactions (
                transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER UNIQUE NOT NULL,
                customer_id INTEGER NOT NULL,
                approved_by_staff_id INTEGER,
                total_item_amount REAL NOT NULL,
                discount_amount REAL DEFAULT 0.0,
                gst_amount REAL DEFAULT 0.0,
                total_payable REAL NOT NULL,
                payment_type TEXT DEFAULT 'UPI',
                payment_status TEXT DEFAULT 'Pending',
                transaction_ref_id TEXT,
                voucher_code TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
                FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE,
                FOREIGN KEY (approved_by_staff_id) REFERENCES staff(staff_id) ON DELETE SET NULL,
                FOREIGN KEY (voucher_code) REFERENCES vouchers(voucher_code) ON DELETE SET NULL
            );
        `);

    // Notifications
    await dbQuery.exec(`
            CREATE TABLE IF NOT EXISTS notifications (
                notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
                recipient_type TEXT DEFAULT 'Customer',
                recipient_id INTEGER NOT NULL,
                order_id INTEGER,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                is_read INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
            );
        `);

    // Inventory / Supplies
    await dbQuery.exec(`
            CREATE TABLE IF NOT EXISTS inventory (
                supply_id INTEGER PRIMARY KEY AUTOINCREMENT,
                supply_name TEXT NOT NULL UNIQUE,
                quantity REAL NOT NULL,
                unit TEXT NOT NULL,
                min_threshold REAL NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

    // Item Ingredients / Supplies Mapping
    await dbQuery.exec(`
            CREATE TABLE IF NOT EXISTS item_supplies (
                item_id INTEGER NOT NULL,
                supply_id INTEGER NOT NULL,
                quantity_required REAL NOT NULL,
                PRIMARY KEY (item_id, supply_id),
                FOREIGN KEY (item_id) REFERENCES items(item_id) ON DELETE CASCADE,
                FOREIGN KEY (supply_id) REFERENCES inventory(supply_id) ON DELETE CASCADE
            );
        `);

    // Ratings Table (Feedback on menu, items, orders)
    await dbQuery.exec(`
            CREATE TABLE IF NOT EXISTS ratings (
                rating_id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL,
                order_id INTEGER NOT NULL,
                menu_id INTEGER,
                item_id INTEGER,
                rating INTEGER CHECK(rating BETWEEN 1 AND 5),
                review TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE,
                FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
            );
        `);

    // General Feedback
    await dbQuery.exec(`
            CREATE TABLE IF NOT EXISTS feedback (
                feedback_id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL,
                message TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE
            );
        `);

    // Advertisement System
    await dbQuery.exec(`
            CREATE TABLE IF NOT EXISTS ads (
                ad_id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                image_url TEXT,
                description TEXT,
                discount_code TEXT,
                is_active INTEGER DEFAULT 1,
                ad_type TEXT DEFAULT 'Promo',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

    // Migration: Add ad_type column to ads if missing
    try {
      await dbQuery.exec(
        "ALTER TABLE ads ADD COLUMN ad_type TEXT DEFAULT 'Promo';",
      );
    } catch (e) {}

    // Change Logs (Customer and Staff)
    await dbQuery.exec(`
            CREATE TABLE IF NOT EXISTS logs (
                log_id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_type TEXT NOT NULL, -- 'Customer' or 'Staff'
                user_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                details TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

    // Safe Alter-table Migrations for Existing database column updates
    const columnMigrations = [
      { table: "menus", col: "canteen_id", spec: "INTEGER" },
      { table: "orders", col: "canteen_id", spec: "INTEGER" },
      { table: "staff", col: "canteen_id", spec: "INTEGER" },
      { table: "items", col: "gst_percentage", spec: "REAL DEFAULT 5.0" },
      { table: "transactions", col: "voucher_code", spec: "TEXT" },
      { table: "vouchers", col: "expiry_date", spec: "TEXT" },
    ];

    for (const migration of columnMigrations) {
      try {
        await dbQuery.exec(
          `ALTER TABLE ${migration.table} ADD COLUMN ${migration.col} ${migration.spec};`,
        );
        console.log(
          `Database migrated: Added ${migration.col} to ${migration.table}`,
        );
      } catch (err) {
        // Ignore errors (means column already exists)
      }
    }

    // CREATE INDEXES FOR HIGH-THROUGHPUT QUERY OPTIMIZATION
    await dbQuery.exec(`
            CREATE INDEX IF NOT EXISTS idx_customers_phone_email ON customers(phone, email);
            CREATE INDEX IF NOT EXISTS idx_orders_customer_date ON orders(customer_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
            CREATE INDEX IF NOT EXISTS idx_transactions_order_status ON transactions(order_id, payment_status);
            CREATE INDEX IF NOT EXISTS idx_logs_type_timestamp ON logs(user_type, timestamp);
            CREATE INDEX IF NOT EXISTS idx_ratings_order_item ON ratings(order_id, item_id);
            CREATE INDEX IF NOT EXISTS idx_items_status ON items(category_id, item_status);
            CREATE INDEX IF NOT EXISTS idx_inventory_name ON inventory(supply_name);
            CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id, is_read);
            CREATE TABLE IF NOT EXISTS device_tokens (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              customer_id INTEGER,
              token TEXT NOT NULL,
              platform TEXT,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_device_tokens_customer ON device_tokens(customer_id);
        `);

    // ==========================================
    // DATABASE DATA SEEDING
    // ==========================================

    // Seed Canteens
    const canteensCount = await dbQuery.get(
      "SELECT COUNT(*) as count FROM canteens",
    );
    if (canteensCount.count === 0) {
      await dbQuery.run(
        "INSERT INTO canteens (canteen_name, location) VALUES ('Main Canteen', 'Main Academic Building, Ground Floor'), ('Library Cafe', 'Central Library Reading Hall, Level 1')",
      );
      console.log("Seeded Canteens.");
    }

    // Seed settings
    const settingsCount = await dbQuery.get(
      "SELECT COUNT(*) as count FROM settings",
    );
    if (settingsCount.count === 0) {
      await dbQuery.run(
        "INSERT INTO settings (key, value) VALUES ('student_discount_percentage', '10')",
      );
      console.log("Seeded default configurations.");
    }

    // Seed Roles (including Event Manager)
    const rolesCount = await dbQuery.get("SELECT COUNT(*) as count FROM roles");
    if (rolesCount.count === 0) {
      await dbQuery.run(
        "INSERT INTO roles (role_name) VALUES ('Admin'), ('Manager'), ('Chef'), ('Accountant'), ('Cashier'), ('Event Manager')",
      );
      console.log("Seeded Roles.");
    }

    // Seed Staff Accounts (linking to canteens)
    const staffCount = await dbQuery.get("SELECT COUNT(*) as count FROM staff");
    if (staffCount.count === 0) {
      const managerHash = await bcrypt.hash('manager123', 10);
      const chefHash = await bcrypt.hash('chef123', 10);
      const accountantHash = await bcrypt.hash('accountant123', 10);
      const eventHash = await bcrypt.hash('event123', 10);

      await dbQuery.run(
        `INSERT INTO staff (role_id, canteen_id, full_name, email, phone, password_hash) VALUES 
                 (2, NULL, 'System Manager', 'manager@canteen.com', '+919999999991', ?),
                 (3, 1, 'Head Chef Main', 'chef@canteen.com', '+919999999992', ?),
                 (4, 1, 'Chief Accountant Main', 'accountant@canteen.com', '+919999999993', ?),
                 (4, 2, 'Library Cafe Accountant', 'lib_accountant@canteen.com', '+919999999994', ?),
                 (6, NULL, 'Event Coordinator', 'event@canteen.com', '+919999999995', ?)`,
        [managerHash, chefHash, accountantHash, accountantHash, eventHash]
      );
      console.log("Seeded default staff accounts with bcrypt hashes.");
    }

    // Seed Menus (Sections - linked to canteens)
    const menusCount = await dbQuery.get("SELECT COUNT(*) as count FROM menus");
    if (menusCount.count === 0) {
      await dbQuery.run(`
                INSERT INTO menus (canteen_id, menu_name, is_active) VALUES 
                (1, 'Snacks Section', 1), (1, 'Beverages Section', 1), (1, 'Meals Section', 1),
                (2, 'Library Bakes & Cakes', 1), (2, 'Library Coffee Bar', 1)
            `);
      console.log("Seeded default menus (Sections).");
    }

    // Seed Categories
    const categoriesCount = await dbQuery.get(
      "SELECT COUNT(*) as count FROM categories",
    );
    if (categoriesCount.count === 0) {
      await dbQuery.run(`
                INSERT INTO categories (menu_id, category_name) VALUES 
                (1, 'Burgers & Sandwiches'), (1, 'Quick Snacks'),
                (2, 'Hot Brews'), (2, 'Cold Beverages'),
                (3, 'Lunch Specials'), (3, 'Combos'),
                (4, 'Oven Fresh Cakes'), (4, 'Pastries'),
                (5, 'Espresso Drinks')
            `);
      console.log("Seeded default categories.");
    }

    // Seed Food Items (incorporating custom GST percentages for retail/ice creams)
    const itemsCount = await dbQuery.get("SELECT COUNT(*) as count FROM items");
    if (itemsCount.count === 0) {
      await dbQuery.run(`
                INSERT INTO items (category_id, item_name, price, item_status, is_healthy, ingredients, image_url, discount_type, discount_value, gst_percentage) VALUES 
                (1, 'Veg Masala Sandwich', 60.00, 'Available', 1, 'Bread, Potato, Butter, Mint Chutney', 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=500', 'Percentage', 10.0, 5.0),
                (1, 'Paneer Burger', 80.00, 'Available', 0, 'Bun, Paneer Patty, Cheese, Onion, Sauce', 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500', 'None', 0.0, 5.0),
                (2, 'Samosa (Plate of 2)', 30.00, 'Available', 0, 'Flour, Potato, Peas, Spices', 'https://images.unsplash.com/photo-1601050690597-df056fb4ce78?w=500', 'Fixed', 5.0, 5.0),
                (3, 'Cardamom Masala Tea', 15.00, 'Available', 1, 'Milk, Tea Leaves, Cardamom, Ginger', 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=500', 'None', 0.0, 5.0),
                (4, 'Cold Coffee with Ice Cream', 50.00, 'Available', 0, 'Milk, Coffee Powder, Sugar, Vanilla Ice Cream', 'https://images.unsplash.com/photo-1595981267035-7b04ca84a82d?w=500', 'Percentage', 20.0, 18.0), -- 18% GST override for Ice Cream/Premium Beverage!
                (5, 'Special Paneer Thali', 120.00, 'Available', 1, 'Paneer Curry, Dal Fry, Jeera Rice, 3 Roti, Salad', 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=500', 'None', 0.0, 5.0),
                (7, 'Oven Baked Chocolate Muffin', 45.00, 'Available', 0, 'Flour, Cocoa Powder, Sugar, Choco chips', 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=500', 'None', 0.0, 18.0), -- 18% retail bake GST
                (8, 'Rich Chocolate Pastry Slice', 70.00, 'Available', 0, 'Sponge cake, Chocolate ganache, Cream', 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=500', 'None', 0.0, 18.0),
                (9, 'Double Shot Espresso', 40.00, 'Available', 1, 'Fresh ground Arabica beans, Water', 'https://images.unsplash.com/photo-1510972527409-cef1b773eb3f?w=500', 'None', 0.0, 5.0)
            `);
      console.log("Seeded default food items.");
    }

    // Seed Inventory
    const inventoryCount = await dbQuery.get(
      "SELECT COUNT(*) as count FROM inventory",
    );
    if (inventoryCount.count === 0) {
      await dbQuery.run(`
                INSERT INTO inventory (supply_name, quantity, unit, min_threshold) VALUES
                ('Bread Loaves', 50, 'packets', 10),
                ('Potatoes', 100, 'kg', 20),
                ('Paneer', 25, 'kg', 5),
                ('Milk', 80, 'liters', 15),
                ('Coffee Powder', 10, 'kg', 2),
                ('Tea Leaves', 8, 'kg', 1.5),
                ('Rice', 150, 'kg', 30),
                ('Dal', 100, 'kg', 20)
            `);
      console.log("Seeded default inventory.");

      // Link item supplies
      await dbQuery.run(
        "INSERT INTO item_supplies (item_id, supply_id, quantity_required) VALUES (1, 1, 0.05), (1, 2, 0.1), (3, 2, 0.15), (5, 4, 0.1), (5, 6, 0.01), (6, 4, 0.2), (6, 5, 0.02), (7, 3, 0.2), (7, 7, 0.2), (7, 8, 0.1)",
      );
      console.log("Seeded item supplies mappings.");
    }

    // Seed Ads
    const adsCount = await dbQuery.get("SELECT COUNT(*) as count FROM ads");
    if (adsCount.count === 0) {
      await dbQuery.run(`
                INSERT INTO ads (title, image_url, description, discount_code, is_active, ad_type) VALUES
                ('Student Special Discount', 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=800', 'Flat 10% OFF for all students on every section! Verify with student category.', 'STUDENT10', 1, 'Promo'),
                ('Happy Hours Cold Coffee Promo', 'https://images.unsplash.com/photo-1595981267035-7b04ca84a82d?w=800', 'Enjoy 20% discount on Cold Coffee with Ice Cream. Beat the heat!', 'COFFEE20', 1, 'Promo'),
                ('Annual College Sports Fest 2026', 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=800', 'Join us tomorrow at 9 AM in the main playground for the inter-collegiate games and events! Food stalls open all day.', '', 1, 'Announcement')
            `);
      console.log("Seeded default advertisements.");
    }

    // Ensure staff passwords are securely hashed: if any password_hash does not look like a bcrypt hash, re-hash it
    try {
      const staffRows = await dbQuery.all(
        "SELECT staff_id, password_hash FROM staff",
      );
      let bcrypt;
      try {
        bcrypt = require("bcrypt");
      } catch (err) {
        bcrypt = require("bcryptjs");
      }
      for (const s of staffRows) {
        if (!s.password_hash || typeof s.password_hash !== "string") continue;
        if (!s.password_hash.startsWith("$2")) {
          const newHash = await bcrypt.hash(s.password_hash, 10);
          await dbQuery.run(
            "UPDATE staff SET password_hash = ? WHERE staff_id = ?",
            [newHash, s.staff_id],
          );
          console.log(`Hashed plaintext password for staff_id=${s.staff_id}`);
        }
      }
    } catch (e) {
      console.error("Failed to migrate staff password hashing:", e.message);
    }
  } catch (e) {
    console.error("DB Initialization Error: ", e);
  }
}

// Export database queries wrapper and initialization
module.exports = {
  ...dbQuery,
  db,
  initDB,
};
