const express = require("express");
const router = express.Router();
const axios = require("axios");
const db = require("../config/db");

// GET: Fetch active orders with details (Managers/Accountants can see everything)
router.get("/active", async (req, res) => {
  const { canteen_id } = req.query;
  try {
    let sql = `
            SELECT o.*, c.full_name, c.email, c.customer_category, t.payment_type, t.payment_status 
            FROM orders o
            JOIN customers c ON o.customer_id = c.customer_id
            JOIN transactions t ON o.order_id = t.order_id
            WHERE o.order_status IN ('Pending', 'AWAITING_CASH_APPROVAL', 'Preparing', 'Ready')
        `;
    const params = [];

    if (canteen_id && canteen_id !== "null" && canteen_id !== "undefined") {
      sql += ` AND o.canteen_id = ?`;
      params.push(parseInt(canteen_id));
    }

    sql += ` ORDER BY o.created_at DESC`;
    const orders = await db.all(sql, params);

    // Fetch details of items inside these active orders
    for (const order of orders) {
      order.items = await db.all(
        `SELECT oi.*, i.item_name, cat.category_name, cat.menu_id, m.menu_name 
                 FROM order_items oi
                 JOIN items i ON oi.item_id = i.item_id
                 JOIN categories cat ON i.category_id = cat.category_id
                 JOIN menus m ON cat.menu_id = m.menu_id
                 WHERE oi.order_id = ?`,
        [order.order_id],
      );
    }

    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET: Fetch active cooking queue for a specific Canteen Section (Menu ID)
router.get("/kitchen-queue/:sectionId", async (req, res) => {
  const { sectionId } = req.params;
  try {
    // Find order items in 'Preparing' status that belong to this section/menu
    const rows = await db.all(
      `SELECT oi.*, i.item_name, o.created_at, o.customer_id, c.full_name as customer_name, c.customer_category
             FROM order_items oi
             JOIN orders o ON oi.order_id = o.order_id
             JOIN customers c ON o.customer_id = c.customer_id
             JOIN items i ON oi.item_id = i.item_id
             JOIN categories cat ON i.category_id = cat.category_id
             WHERE o.order_status = 'Preparing' AND oi.prepared_status = 'Pending' AND cat.menu_id = ?
             ORDER BY o.created_at ASC`,
      [sectionId],
    );
    res.json({ success: true, queue: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Mark specific order item as Prepared (Chef action)
router.post("/item-prepared", async (req, res) => {
  const { order_item_id, order_id } = req.body;
  const staff_id = req.staff ? req.staff.staff_id : 2;

  if (!order_item_id || !order_id) {
    return res
      .status(400)
      .json({ success: false, error: "Missing parameters" });
  }

  try {
    const itemInfo = await db.get(
      `SELECT oi.*, i.item_name, cat.menu_id, m.menu_name, o.customer_id 
             FROM order_items oi
             JOIN items i ON oi.item_id = i.item_id
             JOIN categories cat ON i.category_id = cat.category_id
             JOIN menus m ON cat.menu_id = m.menu_id
             JOIN orders o ON oi.order_id = o.order_id
             WHERE oi.order_item_id = ?`,
      [order_item_id],
    );

    if (!itemInfo)
      return res
        .status(404)
        .json({ success: false, error: "Order item not found" });

    // Update item status to Prepared
    await db.run(
      "UPDATE order_items SET prepared_status = 'Prepared' WHERE order_item_id = ?",
      [order_item_id],
    );

    // Insert notification for specific item completion
    await db.run(
      `INSERT INTO notifications (recipient_type, recipient_id, order_id, title, message) VALUES ('Customer', ?, ?, 'Item Prepared', ?)`,
      [
        itemInfo.customer_id,
        order_id,
        `Your "${itemInfo.item_name}" is ready for pickup at "${itemInfo.menu_name}"!`,
      ],
    );

    // Check if there are other items in the same order that are still pending
    const unready = await db.get(
      "SELECT COUNT(*) as count FROM order_items WHERE order_id = ? AND prepared_status = 'Pending'",
      [order_id],
    );

    let orderReady = false;
    if (unready.count === 0) {
      // Whole order is completed/ready for pickup!
      await db.run(
        "UPDATE orders SET order_status = 'Ready' WHERE order_id = ?",
        [order_id],
      );
      orderReady = true;
      await db.run(
        `INSERT INTO notifications (recipient_type, recipient_id, order_id, title, message) VALUES ('Customer', ?, ?, 'Order Ready!', ?)`,
        [
          itemInfo.customer_id,
          order_id,
          `All items in your Order #${order_id} are prepared. Please collect your order!`,
        ],
      );
    }

    // Log Chef action
    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id,
        "Prepare Item",
        `Marked "${itemInfo.item_name}" in Order #${order_id} as Prepared.`,
      ],
    );

    // Emit a notification to the customer that an item is prepared (big message)
    triggerSocketUpdate(`customer_${itemInfo.customer_id}`, "ITEM_PREPARED", {
      title: "Item Prepared",
      message: `Your item "${itemInfo.item_name}" from Order #${order_id} is ready for pickup.`,
      orderId: order_id,
      item: itemInfo.item_name,
      big: true,
    });

    // Also attempt to send push via customer push endpoint (if configured)
    try {
      const port = process.env.PORT || 5000;
      await axios
        .post(`http://localhost:${port}/api/push/send`, {
          customer_id: itemInfo.customer_id,
          title: "Item Ready",
          message: `Your item "${itemInfo.item_name}" from Order #${order_id} is ready for pickup.`,
          data: { orderId: order_id },
        })
        .catch(() => {});
    } catch (e) {}

    // Send websocket events to Port 5000 Customer Portal
    triggerSocketUpdate(`customer_${itemInfo.customer_id}`, "ORDER_UPDATED", {
      orderId: order_id,
      status: orderReady ? "Ready" : "Preparing",
      message: orderReady
        ? "Your complete order is ready for pickup!"
        : `"${itemInfo.item_name}" is ready!`,
    });

    // Trigger socket for the kitchen itself to update layout
    triggerSocketUpdate(
      `kitchen_section_${itemInfo.menu_id}`,
      "KITCHEN_QUEUE_UPDATED",
      { sectionId: itemInfo.menu_id },
    );

    res.json({
      success: true,
      message: "Item marked prepared.",
      order_ready: orderReady,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Accountant/Cashier Approves Cash payment
router.post("/approve-cash", async (req, res) => {
  const { order_id } = req.body;
  const staff_id = req.staff ? req.staff.staff_id : 3;

  try {
    const order = await db.get(
      `SELECT o.*, c.full_name 
             FROM orders o 
             JOIN customers c ON o.customer_id = c.customer_id
             WHERE o.order_id = ? AND o.order_status = 'AWAITING_CASH_APPROVAL'`,
      [order_id],
    );

    if (!order)
      return res.status(404).json({
        success: false,
        error: "Order not found or not awaiting cash payment.",
      });

    await db.run("BEGIN TRANSACTION");

    // Update payment success and link cashier ID
    await db.run(
      `UPDATE transactions 
             SET payment_status = 'Success', approved_by_staff_id = ? 
             WHERE order_id = ?`,
      [staff_id, order_id],
    );

    // Update order status to cooking
    await db.run(
      "UPDATE orders SET order_status = 'Preparing' WHERE order_id = ?",
      [order_id],
    );

    await db.run("COMMIT");

    // Insert notification
    await db.run(
      `INSERT INTO notifications (recipient_type, recipient_id, order_id, title, message)
             VALUES ('Customer', ?, ?, 'Cash Approved', 'Cash paid at counter for Order #${order_id} verified. Kitchen is preparing food.')`,
      [order.customer_id, order_id],
    );

    // Log Accountant action
    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id,
        "Approve Cash Payment",
        `Approved Cash payment for Order #${order_id} (Customer: ${order.full_name})`,
      ],
    );

    // Trigger Socket to Customer
    triggerSocketUpdate(`customer_${order.customer_id}`, "ORDER_UPDATED", {
      orderId: order_id,
      status: "Preparing",
      message: "Cash approved. Food is being prepared!",
    });

    // Send a notification to customer
    triggerSocketUpdate(`customer_${order.customer_id}`, "NOTIFICATION", {
      title: "Payment Received",
      message: `Cash payment for Order #${order_id} has been accepted. Kitchen will prepare your order.`,
      big: true,
      orderId: order_id,
    });
    try {
      const port = process.env.PORT || 5000;
      await axios
        .post(`http://localhost:${port}/api/push/send`, {
          customer_id: order.customer_id,
          title: "Payment Received",
          message: `Cash payment for Order #${order_id} has been accepted. Kitchen will prepare your order.`,
          data: { orderId: order_id },
        })
        .catch(() => {});
    } catch (e) {}

    // Trigger Socket to Chef displays
    const orderItemsInfo = await db.all(
      `SELECT oi.item_id, oi.quantity, i.item_name, cat.menu_id 
             FROM order_items oi
             JOIN items i ON oi.item_id = i.item_id
             JOIN categories cat ON i.category_id = cat.category_id
             WHERE oi.order_id = ?`,
      [order_id],
    );

    const sectionGroups = {};
    orderItemsInfo.forEach((oItem) => {
      if (!sectionGroups[oItem.menu_id]) sectionGroups[oItem.menu_id] = [];
      sectionGroups[oItem.menu_id].push(
        `${oItem.quantity}x ${oItem.item_name}`,
      );
    });

    for (const sectionId in sectionGroups) {
      triggerSocketUpdate(`kitchen_section_${sectionId}`, "NEW_KITCHEN_ORDER", {
        orderId: order_id,
        customer_name: order.full_name,
        items: sectionGroups[sectionId],
      });
    }

    // Global cashier update
    triggerSocketUpdate("cashier_room", "CASH_APPROVAL_COMPLETED", {
      order_id,
    });

    res.json({
      success: true,
      message: "Cash order approved. Food preparation started.",
    });
  } catch (err) {
    await db.run("ROLLBACK");
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Accountant Approves Settlement (Cash or UPI)
router.post("/approve-settlement", async (req, res) => {
  const { order_id } = req.body;
  const staff_id = req.staff ? req.staff.staff_id : 3;

  try {
    const order = await db.get(
      `SELECT o.*, c.full_name, t.payment_type, t.payment_status, t.total_payable, t.customer_id 
             FROM orders o 
             JOIN customers c ON o.customer_id = c.customer_id
             JOIN transactions t ON o.order_id = t.order_id
             WHERE o.order_id = ?`,
      [order_id],
    );

    if (!order)
      return res.status(404).json({ success: false, error: "Order not found" });

    if (order.payment_status === "Success")
      return res.status(400).json({ success: false, error: "Already settled" });

    // Only allow settlement if payment is awaiting settlement or cash awaiting approval
    if (
      !(
        order.payment_status === "Awaiting Settlement" ||
        order.order_status === "AWAITING_CASH_APPROVAL" ||
        order.payment_status === "Pending"
      )
    ) {
      return res
        .status(400)
        .json({ success: false, error: "Order not awaiting settlement." });
    }

    await db.run("BEGIN TRANSACTION");

    await db.run(
      `UPDATE transactions SET payment_status = 'Success', approved_by_staff_id = ? WHERE order_id = ?`,
      [staff_id, order_id],
    );

    await db.run(
      `UPDATE orders SET order_status = 'Preparing' WHERE order_id = ?`,
      [order_id],
    );

    await db.run("COMMIT");

    // Add notification and logs
    await db.run(
      `INSERT INTO notifications (recipient_type, recipient_id, order_id, title, message)
             VALUES ('Customer', ?, ?, 'Payment Settled', 'Your payment for Order #${order_id} has been settled by accountant.')`,
      [order.customer_id, order_id],
    );

    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id,
        "Settle Payment",
        `Settled payment for Order #${order_id} (Type: ${order.payment_type})`,
      ],
    );

    // Trigger sockets (customer + kitchen)
    triggerSocketUpdate(`customer_${order.customer_id}`, "ORDER_UPDATED", {
      orderId: order_id,
      status: "Preparing",
      message: "Payment settled. Food is being prepared.",
    });

    // Also notify customer via socket + push
    triggerSocketUpdate(`customer_${order.customer_id}`, "NOTIFICATION", {
      title: "Payment Settled",
      message: `Your payment for Order #${order_id} has been settled by accountant. Kitchen will prepare your order.`,
      big: true,
      orderId: order_id,
    });
    try {
      const port = process.env.PORT || 5000;
      await axios
        .post(`http://localhost:${port}/api/push/send`, {
          customer_id: order.customer_id,
          title: "Payment Settled",
          message: `Your payment for Order #${order_id} has been settled by accountant. Kitchen will prepare your order.`,
          data: { orderId: order_id },
        })
        .catch(() => {});
    } catch (e) {}

    const orderItemsInfo = await db.all(
      `SELECT oi.item_id, oi.quantity, i.item_name, cat.menu_id 
             FROM order_items oi
             JOIN items i ON oi.item_id = i.item_id
             JOIN categories cat ON i.category_id = cat.category_id
             WHERE oi.order_id = ?`,
      [order_id],
    );

    const sectionGroups = {};
    orderItemsInfo.forEach((oItem) => {
      if (!sectionGroups[oItem.menu_id]) sectionGroups[oItem.menu_id] = [];
      sectionGroups[oItem.menu_id].push(
        `${oItem.quantity}x ${oItem.item_name}`,
      );
    });

    for (const sectionId in sectionGroups) {
      triggerSocketUpdate(`kitchen_section_${sectionId}`, "NEW_KITCHEN_ORDER", {
        orderId: order_id,
        customer_name: order.full_name,
        items: sectionGroups[sectionId],
      });
    }

    res.json({
      success: true,
      message: "Settlement approved and order forwarded to kitchen.",
    });
  } catch (err) {
    await db.run("ROLLBACK");
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Cancel Order (Counter Cash cashier action)
router.post("/cancel-order", async (req, res) => {
  const { order_id } = req.body;
  const staff_id = req.staff ? req.staff.staff_id : 1;
  if (!order_id)
    return res.status(400).json({ success: false, error: "Missing order_id" });

  try {
    const order = await db.get("SELECT * FROM orders WHERE order_id = ?", [
      order_id,
    ]);
    if (!order)
      return res.status(404).json({ success: false, error: "Order not found" });
    if (
      order.order_status !== "AWAITING_CASH_APPROVAL" &&
      order.order_status !== "Pending"
    ) {
      return res.status(400).json({
        success: false,
        error: "Only pending cash/unpaid orders can be cancelled.",
      });
    }

    await db.run("BEGIN TRANSACTION");

    // Update status to Cancelled
    await db.run(
      "UPDATE orders SET order_status = 'Cancelled' WHERE order_id = ?",
      [order_id],
    );
    await db.run(
      "UPDATE transactions SET payment_status = 'Cancelled' WHERE order_id = ?",
      [order_id],
    );

    // Restore inventory stock levels
    const orderItems = await db.all(
      "SELECT * FROM order_items WHERE order_id = ?",
      [order_id],
    );
    for (const orderItem of orderItems) {
      const itemSupplies = await db.all(
        "SELECT * FROM item_supplies WHERE item_id = ?",
        [orderItem.item_id],
      );
      for (const supply of itemSupplies) {
        const totalRestore = supply.quantity_required * orderItem.quantity;
        await db.run(
          "UPDATE inventory SET quantity = quantity + ? WHERE supply_id = ?",
          [totalRestore, supply.supply_id],
        );
      }
    }

    // Restore voucher if used
    const txn = await db.get(
      "SELECT voucher_code FROM transactions WHERE order_id = ?",
      [order_id],
    );
    if (txn && txn.voucher_code) {
      await db.run(
        "UPDATE vouchers SET is_used = 0, used_by_customer_id = NULL WHERE voucher_code = ?",
        [txn.voucher_code],
      );
    }

    await db.run("COMMIT");

    // Log cashier cancel action
    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id,
        "Cancel Cash Order",
        `Cancelled Order #${order_id} (Unpaid) and restored stock.`,
      ],
    );

    // Notify client & KDS
    triggerSocketUpdate(`customer_${order.customer_id}`, "ORDER_UPDATED", {
      orderId: order_id,
      status: "Cancelled",
      message: "Your cash order was cancelled by the counter cashier.",
    });

    triggerSocketUpdate("cashier_room", "CASH_APPROVAL_COMPLETED", {
      order_id,
    });

    res.json({
      success: true,
      message: "Order cancelled and inventory quantities restored.",
    });
  } catch (err) {
    await db.run("ROLLBACK");
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Mark order as Completed (Handed over to customer)
router.post("/complete-order", async (req, res) => {
  const { order_id } = req.body;
  const staff_id = req.staff ? req.staff.staff_id : 1;

  try {
    const order = await db.get("SELECT * FROM orders WHERE order_id = ?", [
      order_id,
    ]);
    if (!order)
      return res.status(404).json({ success: false, error: "Order not found" });

    await db.run(
      "UPDATE orders SET order_status = 'Completed' WHERE order_id = ?",
      [order_id],
    );

    // Log completion
    await db.run(
      `INSERT INTO logs (user_type, user_id, action, details) VALUES (?, ?, ?, ?)`,
      [
        "Staff",
        staff_id,
        "Complete Order",
        `Completed and delivered Order #${order_id} to customer.`,
      ],
    );

    // Notify client
    triggerSocketUpdate(`customer_${order.customer_id}`, "ORDER_UPDATED", {
      orderId: order_id,
      status: "Completed",
      message: "Order handed over! Thank you for dining with us.",
    });

    res.json({ success: true, message: "Order marked as completed." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper for socket trigger calls
function triggerSocketUpdate(room, event, data) {
  const payload = { room, event, data };
  const port = process.env.PORT || 5000;
  axios
    .post(`http://localhost:${port}/api/internal/trigger-socket`, payload)
    .catch((err) =>
      console.error(
        "Failed to propagate socket broadcast internally:",
        err.message,
      ),
    );
}

module.exports = router;
