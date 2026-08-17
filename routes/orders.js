const express = require("express");
const router = express.Router();
const QRCode = require("qrcode");
const axios = require("axios"); // We can use standard node fetch or http to trigger local sockets, or axios
const db = require("../config/db");

// Canteen UPI Configuration
const UPI_CONFIG = {
  vpa: "canteen@upi",
  merchantName: "Campus Central Canteen",
  gstPercentage: 5.0,
  studentDiscountPercentage: 10.0,
};

// Create Order (with stock verification, discounts, and auto-payment dispatch)
router.post("/create", async (req, res) => {
  const { customer_id, cart_items, payment_type } = req.body;
  const mode = payment_type || "UPI";

  if (!cart_items || cart_items.length === 0) {
    return res.status(400).json({ success: false, error: "Cart is empty" });
  }

  try {
    // Retrieve customer category
    const customer = await db.get(
      "SELECT * FROM customers WHERE customer_id = ?",
      [customer_id],
    );
    if (!customer)
      return res
        .status(404)
        .json({ success: false, error: "Customer profile not found" });

    // Step 1: Stock / Supply Check & Ingredient Mapping
    const ingredientsNeeded = {}; // supply_id -> { name, quantityNeeded, currentStock }

    for (const cartItem of cart_items) {
      const itemSupplies = await db.all(
        "SELECT s.*, isup.quantity_required FROM item_supplies isup JOIN inventory s ON isup.supply_id = s.supply_id WHERE isup.item_id = ?",
        [cartItem.item_id],
      );

      for (const supply of itemSupplies) {
        const totalNeeded = supply.quantity_required * cartItem.quantity;
        if (ingredientsNeeded[supply.supply_id]) {
          ingredientsNeeded[supply.supply_id].needed += totalNeeded;
        } else {
          ingredientsNeeded[supply.supply_id] = {
            name: supply.supply_name,
            needed: totalNeeded,
            stock: supply.quantity,
          };
        }
      }
    }

    // Validate stock levels
    for (const supplyId in ingredientsNeeded) {
      const item = ingredientsNeeded[supplyId];
      if (item.stock < item.needed) {
        return res.status(400).json({
          success: false,
          error: `Insufficient Stock: "${item.name}" (Needed: ${item.needed.toFixed(2)}, Available: ${item.stock.toFixed(2)}). Cannot prepare order.`,
        });
      }
    }

    // Step 2: Calculate prices, applying item-specific discounts
    let subtotal = 0;
    let totalItemsCount = 0;
    const processedItems = [];

    for (const cartItem of cart_items) {
      const dbItem = await db.get("SELECT * FROM items WHERE item_id = ?", [
        cartItem.item_id,
      ]);
      if (!dbItem || dbItem.item_status !== "Available") {
        return res
          .status(400)
          .json({
            success: false,
            error: `Item "${cartItem.item_name}" is no longer available.`,
          });
      }

      // Calculate item price
      let unitPrice = dbItem.price;
      if (dbItem.discount_type === "Percentage") {
        unitPrice = dbItem.price * (1 - dbItem.discount_value / 100);
      } else if (dbItem.discount_type === "Fixed") {
        unitPrice = dbItem.price - dbItem.discount_value;
      }
      unitPrice = Math.max(0, parseFloat(unitPrice.toFixed(2)));

      const itemSubtotal = unitPrice * cartItem.quantity;
      subtotal += itemSubtotal;
      totalItemsCount += cartItem.quantity;

      processedItems.push({
        item_id: cartItem.item_id,
        quantity: cartItem.quantity,
        unit_price: unitPrice,
        subtotal: itemSubtotal,
        gst_percentage:
          dbItem.gst_percentage !== undefined ? dbItem.gst_percentage : 5.0,
      });
    }

    // Step 3: Apply discounts (Settings student discount + Vouchers)
    const canteen_id = parseInt(req.body.canteen_id || 1);
    const studentDiscountSetting = await db.get(
      "SELECT value FROM settings WHERE key = 'student_discount_percentage'",
    );
    const studentDiscountPct = studentDiscountSetting
      ? parseFloat(studentDiscountSetting.value)
      : 10.0;

    let studentDiscountAmount = 0.0;
    if (customer.customer_category === "Student") {
      studentDiscountAmount = parseFloat(
        (subtotal * (studentDiscountPct / 100)).toFixed(2),
      );
    }

    let voucherDiscountAmount = 0.0;
    let isFreeMeal = false;
    let voucherObj = null;
    const voucherCodeInput = req.body.voucher_code
      ? req.body.voucher_code.trim()
      : null;

    if (voucherCodeInput) {
      voucherObj = await db.get(
        "SELECT * FROM vouchers WHERE voucher_code = ?",
        [voucherCodeInput],
      );
      if (!voucherObj) {
        return res
          .status(400)
          .json({ success: false, error: "Invalid voucher code." });
      }
      if (voucherObj.is_used === 1) {
        return res
          .status(400)
          .json({ success: false, error: "Voucher has already been used." });
      }
      if (voucherObj.canteen_id && voucherObj.canteen_id !== canteen_id) {
        return res
          .status(400)
          .json({
            success: false,
            error: "Voucher is not valid for this canteen location.",
          });
      }
      if (voucherObj.expiry_date) {
        const today = new Date().toISOString().split("T")[0];
        if (voucherObj.expiry_date < today) {
          return res
            .status(400)
            .json({ success: false, error: "Voucher has expired." });
        }
      }

      if (voucherObj.discount_type === "Percentage") {
        voucherDiscountAmount = parseFloat(
          (subtotal * (voucherObj.discount_value / 100)).toFixed(2),
        );
      } else if (voucherObj.discount_type === "Fixed") {
        voucherDiscountAmount = parseFloat(
          voucherObj.discount_value.toFixed(2),
        );
      } else if (voucherObj.discount_type === "FreeMeal") {
        isFreeMeal = true;
        voucherDiscountAmount = subtotal;
      }
    }

    let totalDiscount = parseFloat(
      (studentDiscountAmount + voucherDiscountAmount).toFixed(2),
    );
    if (totalDiscount > subtotal) {
      totalDiscount = subtotal;
    }

    // Calculate item-by-item GST on the net taxable amount
    const discountRatio = subtotal > 0 ? totalDiscount / subtotal : 0;
    let gstAmount = 0.0;

    if (!isFreeMeal) {
      processedItems.forEach((item) => {
        const netItemPrice = item.unit_price * (1 - discountRatio);
        const itemGst =
          netItemPrice * item.quantity * (item.gst_percentage / 100);
        gstAmount += itemGst;
      });
      gstAmount = parseFloat(gstAmount.toFixed(2));
    }

    const totalPayable = isFreeMeal
      ? 0.0
      : parseFloat((subtotal - totalDiscount + gstAmount).toFixed(2));
    const initialOrderStatus =
      mode === "Cash"
        ? "AWAITING_CASH_APPROVAL"
        : totalPayable === 0.0
          ? "Preparing"
          : "Pending";

    // Transaction DB write block
    await db.run("BEGIN TRANSACTION");

    // Insert Order
    const orderResult = await db.run(
      `INSERT INTO orders (customer_id, canteen_id, total_items, total_amount, order_status) VALUES (?, ?, ?, ?, ?)`,
      [
        customer_id,
        canteen_id,
        totalItemsCount,
        totalPayable,
        initialOrderStatus,
      ],
    );
    const orderId = orderResult.lastID;

    // Insert Order Items
    for (const item of processedItems) {
      await db.run(
        `INSERT INTO order_items (order_id, item_id, quantity, unit_price, subtotal, prepared_status) VALUES (?, ?, ?, ?, ?, 'Pending')`,
        [orderId, item.item_id, item.quantity, item.unit_price, item.subtotal],
      );
    }

    // Insert Transaction record
    await db.run(
      `INSERT INTO transactions 
             (order_id, customer_id, total_item_amount, discount_amount, gst_amount, total_payable, payment_type, payment_status, voucher_code)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        customer_id,
        subtotal,
        totalDiscount,
        gstAmount,
        totalPayable,
        totalPayable === 0.0 ? "Voucher" : mode,
        totalPayable === 0.0 ? "Success" : "Pending",
        voucherCodeInput,
      ],
    );

    // Mark voucher as used if applicable
    if (voucherObj) {
      await db.run(
        `UPDATE vouchers SET is_used = 1, used_by_customer_id = ? WHERE voucher_code = ?`,
        [customer_id, voucherCodeInput],
      );
    }

    // Deduct Inventory supplies
    for (const supplyId in ingredientsNeeded) {
      const item = ingredientsNeeded[supplyId];
      await db.run(
        `UPDATE inventory SET quantity = quantity - ? WHERE supply_id = ?`,
        [item.needed, supplyId],
      );
    }

    await db.run("COMMIT");

    // Generate payment payloads
    let qrCodeDataUrl = null;
    let upiDeepLink = null;
    let upiRefId = `TXN_${orderId}_${Date.now()}`;

    if (mode === "UPI" && totalPayable > 0) {
      upiDeepLink = `upi://pay?pa=${encodeURIComponent(UPI_CONFIG.vpa)}&pn=${encodeURIComponent(UPI_CONFIG.merchantName)}&am=${totalPayable}&tr=${upiRefId}&cu=INR`;
      qrCodeDataUrl = await QRCode.toDataURL(upiDeepLink);
    }

    // Socket warning dispatch to cashier if Cash payment
    if (mode === "Cash") {
      triggerSocketUpdate("cashier_room", "NEW_CASH_APPROVAL_REQUEST", {
        order_id: orderId,
        customer_name: customer.full_name,
        customer_category: customer.customer_category,
        total_amount: totalPayable,
      });
    }

    // Note: UPI payments require customer confirmation and accountant settlement.
    // When mode === 'UPI' we leave transactions.payment_status as 'Pending' and wait for
    // the customer to click "I have paid" which will mark the transaction as 'Awaiting Settlement'.
    // Accountant will then approve settlement via staff endpoints.

    // If order is free (from FreeMeal voucher), immediately trigger kitchen queues
    if (totalPayable === 0.0) {
      setTimeout(async () => {
        try {
          const orderItemsInfo = await db.all(
            `SELECT oi.item_id, oi.quantity, i.item_name, cat.menu_id 
                         FROM order_items oi
                         JOIN items i ON oi.item_id = i.item_id
                         JOIN categories cat ON i.category_id = cat.category_id
                         WHERE oi.order_id = ?`,
            [orderId],
          );
          const sectionGroups = {};
          orderItemsInfo.forEach((oItem) => {
            if (!sectionGroups[oItem.menu_id])
              sectionGroups[oItem.menu_id] = [];
            sectionGroups[oItem.menu_id].push(
              `${oItem.quantity}x ${oItem.item_name}`,
            );
          });

          for (const sectionId in sectionGroups) {
            triggerSocketUpdate(
              `kitchen_section_${sectionId}`,
              "NEW_KITCHEN_ORDER",
              {
                orderId: orderId,
                customer_name: customer.full_name,
                items: sectionGroups[sectionId],
              },
            );
          }

          triggerSocketUpdate("kitchen_global", "NEW_KITCHEN_ORDER", {
            orderId: orderId,
            customer_name: customer.full_name,
          });
        } catch (e) {
          console.error("Free order propagation failed:", e);
        }
      }, 500);
    }

    return res.json({
      success: true,
      order_id: orderId,
      total_payable: totalPayable,
      upi_ref_id: upiRefId,
      upi_link: upiDeepLink,
      qr_code: qrCodeDataUrl,
      payment_type: totalPayable === 0.0 ? "Voucher" : mode,
    });
  } catch (err) {
    await db.run("ROLLBACK");
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET: Retrieve customer order history
router.get("/customer/:customerId", async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT o.*, t.payment_type, t.payment_status 
             FROM orders o
             JOIN transactions t ON o.order_id = t.order_id
             WHERE o.customer_id = ? 
             ORDER BY o.created_at DESC LIMIT 20`,
      [req.params.customerId],
    );
    res.json({ success: true, orders: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper function to trigger Socket.io broadcasts on port 5000 server
function triggerSocketUpdate(room, event, data) {
  // Make local POST request
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

// GET: Check if active vouchers exist in the system (returns boolean only, no codes leaked)
router.get("/vouchers/active-exists", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const row = await db.get(
      `SELECT COUNT(*) as count FROM vouchers 
       WHERE is_used = 0 AND (expiry_date IS NULL OR expiry_date >= ?)`,
      [today],
    );
    res.json({ success: true, exists: row.count > 0 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: Validate individual voucher code safely
router.post("/validate-voucher", async (req, res) => {
  const { code, canteen_id } = req.body;
  if (!code) return res.status(400).json({ success: false, error: "Voucher code is required" });

  try {
    const voucher = await db.get("SELECT * FROM vouchers WHERE voucher_code = ?", [code.toUpperCase().trim()]);
    if (!voucher) {
      return res.json({ success: false, error: "Invalid voucher code." });
    }
    if (voucher.is_used === 1) {
      return res.json({ success: false, error: "Voucher code has already been used." });
    }
    if (voucher.canteen_id && voucher.canteen_id !== parseInt(canteen_id)) {
      return res.json({ success: false, error: "Voucher is not valid for this canteen location." });
    }
    if (voucher.expiry_date) {
      const today = new Date().toISOString().split("T")[0];
      if (voucher.expiry_date < today) {
        return res.json({ success: false, error: "Voucher has expired." });
      }
    }
    res.json({
      success: true,
      voucher: {
        voucher_code: voucher.voucher_code,
        discount_type: voucher.discount_type,
        discount_value: voucher.discount_value,
        canteen_id: voucher.canteen_id,
        expiry_date: voucher.expiry_date
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
