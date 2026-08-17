const express = require("express");
const router = express.Router();
const axios = require("axios");
const db = require("../config/db");

// GET: Check payment/order transaction status
router.get("/status/:orderId", async (req, res) => {
  try {
    const transaction = await db.get(
      `SELECT t.*, o.order_status 
             FROM transactions t
             JOIN orders o ON t.order_id = o.order_id
             WHERE t.order_id = ?`,
      [req.params.orderId],
    );
    if (!transaction)
      return res
        .status(404)
        .json({ success: false, error: "Transaction not found" });
    res.json({ success: true, transaction });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Direct Manual Check/Verify Payment
router.post("/verify", async (req, res) => {
  const { order_id, customer_id } = req.body;

  try {
    // Fetch current payment status
    const tx = await db.get("SELECT * FROM transactions WHERE order_id = ?", [
      order_id,
    ]);
    if (!tx)
      return res
        .status(404)
        .json({ success: false, error: "Transaction not found" });

    if (tx.payment_status === "Success") {
      return res.json({
        success: true,
        message: "Payment already verified successfully.",
      });
    }

    // If not already success, force verify it immediately
    await db.run(
      `UPDATE transactions SET payment_status = 'Success', transaction_ref_id = ? WHERE order_id = ?`,
      [`MANUAL_${order_id}_${Date.now()}`, order_id],
    );
    await db.run(
      `UPDATE orders SET order_status = 'Preparing' WHERE order_id = ?`,
      [order_id],
    );

    // Add notification
    await db.run(
      `INSERT INTO notifications (recipient_type, recipient_id, order_id, title, message)
             VALUES ('Customer', ?, ?, 'Payment Verified', 'UPI Payment verified manually. Food is now cooking.')`,
      [customer_id, order_id],
    );

    // Emit Socket notifications
    triggerSocketUpdate(`customer_${customer_id}`, "ORDER_UPDATED", {
      orderId: order_id,
      status: "Preparing",
      message: "Payment verified. Food is being prepared!",
    });

    // Notify Kitchen
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

    const customerInfo = await db.get(
      "SELECT full_name FROM customers WHERE customer_id = ?",
      [customer_id],
    );

    for (const sectionId in sectionGroups) {
      triggerSocketUpdate(`kitchen_section_${sectionId}`, "NEW_KITCHEN_ORDER", {
        orderId: order_id,
        customer_name: customerInfo.full_name,
        items: sectionGroups[sectionId],
      });
    }

    triggerSocketUpdate("kitchen_global", "NEW_KITCHEN_ORDER", {
      orderId: order_id,
      customer_name: customerInfo.full_name,
    });

    res.json({
      success: true,
      message: "Manual payment confirmation approved.",
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Note: /confirm-paid is implemented in payments_extra.js to handle customer 'I have paid' flow.

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
