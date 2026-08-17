const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const db = require("../config/db");

const ARCHIVES_DIR = path.join(__dirname, "..", "archives");

// Ensure archives directory exists
if (!fs.existsSync(ARCHIVES_DIR)) {
  fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
}

// GET: List all archived database files
router.get("/files", async (req, res) => {
  try {
    const files = fs
      .readdirSync(ARCHIVES_DIR)
      .filter((file) => file.endsWith(".db"))
      .map((file) => {
        const filePath = path.join(ARCHIVES_DIR, file);
        const stats = fs.statSync(filePath);
        return {
          filename: file,
          size: stats.size,
          created_at: stats.birthtime,
        };
      });
    res.json({ success: true, files });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Run Archive & Purge process
router.post("/run", async (req, res) => {
  const { days = 365 } = req.body; // Default is 1 year (365 days)
  const staff_id = req.staff ? req.staff.staff_id : 1;

  try {
    // Step 1: Count records older than threshold days
    const ordersCount = await db.get(
      `SELECT COUNT(*) as count FROM orders WHERE created_at < datetime('now', '-' || ? || ' days')`,
      [days],
    );

    if (ordersCount.count === 0) {
      return res.json({
        success: false,
        message: `No orders found older than ${days} days. Nothing to archive.`,
      });
    }

    // Step 2: Create archive database file
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const archiveName = `canteen_archive_older_than_${days}d_${timestamp}.db`;
    const archivePath = path.join(ARCHIVES_DIR, archiveName);

    const archiveDb = new sqlite3.Database(archivePath);

    const runArchiveQuery = (sql, params = []) => {
      return new Promise((resolve, reject) => {
        archiveDb.run(sql, params, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    };

    // Create table schemas in the archive database
    await runArchiveQuery(`
            CREATE TABLE IF NOT EXISTS orders (
                order_id INTEGER PRIMARY KEY,
                customer_id INTEGER,
                total_items INTEGER,
                total_amount REAL,
                order_status TEXT,
                created_at DATETIME
            );
        `);
    await runArchiveQuery(`
            CREATE TABLE IF NOT EXISTS order_items (
                order_item_id INTEGER PRIMARY KEY,
                order_id INTEGER,
                item_id INTEGER,
                quantity INTEGER,
                unit_price REAL,
                subtotal REAL,
                prepared_status TEXT
            );
        `);
    await runArchiveQuery(`
            CREATE TABLE IF NOT EXISTS transactions (
                transaction_id INTEGER PRIMARY KEY,
                order_id INTEGER UNIQUE,
                customer_id INTEGER,
                approved_by_staff_id INTEGER,
                total_item_amount REAL,
                discount_amount REAL,
                gst_amount REAL,
                total_payable REAL,
                payment_type TEXT,
                payment_status TEXT,
                transaction_ref_id TEXT,
                created_at DATETIME
            );
        `);
    await runArchiveQuery(`
            CREATE TABLE IF NOT EXISTS logs (
                log_id INTEGER PRIMARY KEY,
                user_type TEXT,
                user_id INTEGER,
                action TEXT,
                details TEXT,
                timestamp DATETIME
            );
        `);

    // Fetch old data from active database
    const oldOrders = await db.all(
      `SELECT * FROM orders WHERE created_at < datetime('now', '-' || ? || ' days')`,
      [days],
    );
    const oldOrderIds = oldOrders.map((o) => o.order_id);

    let oldOrderItems = [];
    let oldTransactions = [];
    if (oldOrderIds.length > 0) {
      const placeholders = oldOrderIds.map(() => "?").join(",");
      oldOrderItems = await db.all(
        `SELECT * FROM order_items WHERE order_id IN (${placeholders})`,
        oldOrderIds,
      );
      oldTransactions = await db.all(
        `SELECT * FROM transactions WHERE order_id IN (${placeholders})`,
        oldOrderIds,
      );
    }

    const oldLogs = await db.all(
      `SELECT * FROM logs WHERE timestamp < datetime('now', '-' || ? || ' days')`,
      [days],
    );

    // Copy records to archive DB
    archiveDb.serialize(async () => {
      // Insert Orders
      for (const order of oldOrders) {
        archiveDb.run(
          `INSERT INTO orders (order_id, customer_id, total_items, total_amount, order_status, created_at)
                     VALUES (?, ?, ?, ?, ?, ?)`,
          [
            order.order_id,
            order.customer_id,
            order.total_items,
            order.total_amount,
            order.order_status,
            order.created_at,
          ],
        );
      }

      // Insert Order Items
      for (const item of oldOrderItems) {
        archiveDb.run(
          `INSERT INTO order_items (order_item_id, order_id, item_id, quantity, unit_price, subtotal, prepared_status)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            item.order_item_id,
            item.order_id,
            item.item_id,
            item.quantity,
            item.unit_price,
            item.subtotal,
            item.prepared_status,
          ],
        );
      }

      // Insert Transactions
      for (const tx of oldTransactions) {
        archiveDb.run(
          `INSERT INTO transactions (transaction_id, order_id, customer_id, approved_by_staff_id, total_item_amount, discount_amount, gst_amount, total_payable, payment_type, payment_status, transaction_ref_id, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            tx.transaction_id,
            tx.order_id,
            tx.customer_id,
            tx.approved_by_staff_id,
            tx.total_item_amount,
            tx.discount_amount,
            tx.gst_amount,
            tx.total_payable,
            tx.payment_type,
            tx.payment_status,
            tx.transaction_ref_id,
            tx.created_at,
          ],
        );
      }

      // Insert Logs
      for (const log of oldLogs) {
        archiveDb.run(
          `INSERT INTO logs (log_id, user_type, user_id, action, details, timestamp)
                     VALUES (?, ?, ?, ?, ?, ?)`,
          [
            log.log_id,
            log.user_type,
            log.user_id,
            log.action,
            log.details,
            log.timestamp,
          ],
        );
      }

      archiveDb.close();
    });

    // Step 3: Purge old data from active DB inside a transaction
    await db.run("BEGIN TRANSACTION");
    if (oldOrderIds.length > 0) {
      const placeholders = oldOrderIds.map(() => "?").join(",");
      await db.run(
        `DELETE FROM order_items WHERE order_id IN (${placeholders})`,
        oldOrderIds,
      );
      await db.run(
        `DELETE FROM transactions WHERE order_id IN (${placeholders})`,
        oldOrderIds,
      );
      await db.run(
        `DELETE FROM ratings WHERE order_id IN (${placeholders})`,
        oldOrderIds,
      );
      await db.run(
        `DELETE FROM orders WHERE order_id IN (${placeholders})`,
        oldOrderIds,
      );
    }
    await db.run(
      `DELETE FROM logs WHERE timestamp < datetime('now', '-' || ? || ' days')`,
      [days],
    );
    await db.run("COMMIT");

    // Reclaim unused space in active SQLite DB
    await db.exec("VACUUM;");

    // Log manager action
    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id,
        "Archive Database",
        `Archived ${ordersCount.count} orders older than ${days} days into file "${archiveName}" and purged active database.`,
      ],
    );

    res.json({
      success: true,
      message: `Archive completed. ${ordersCount.count} orders exported to "${archiveName}" and database purged.`,
      filename: archiveName,
      purged_records: ordersCount.count,
    });
  } catch (err) {
    await db.run("ROLLBACK");
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Query historical archive reports
router.post("/query", async (req, res) => {
  const { filename } = req.body;

  if (!filename)
    return res
      .status(400)
      .json({ success: false, error: "Filename is required" });

  const archivePath = path.join(ARCHIVES_DIR, filename);
  if (!fs.existsSync(archivePath)) {
    return res
      .status(404)
      .json({ success: false, error: "Archive file not found." });
  }

  const archiveDb = new sqlite3.Database(archivePath);

  const queryArchive = (sql, params = []) => {
    return new Promise((resolve, reject) => {
      archiveDb.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  };

  try {
    // Query basic financial stats of the archive
    const summary = await queryArchive(
      `SELECT COUNT(transaction_id) as total_txs,
                    SUM(total_payable) as gross_revenue,
                    SUM(discount_amount) as total_discounts
             FROM transactions 
             WHERE payment_status = 'Success'`,
    );

    // Fetch transaction listings
    const transactions = await queryArchive(
      `SELECT t.*, o.order_status
             FROM transactions t
             JOIN orders o ON t.order_id = o.order_id
             ORDER BY t.created_at DESC LIMIT 100`,
    );

    archiveDb.close();

    res.json({
      success: true,
      summary: {
        total_transactions: summary[0].total_txs || 0,
        gross_revenue: summary[0].gross_revenue || 0.0,
        total_discounts: summary[0].total_discounts || 0.0,
      },
      transactions,
    });
  } catch (err) {
    archiveDb.close();
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
