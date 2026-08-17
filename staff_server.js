const express = require("express");
const cors = require("cors");
const path = require("path");
const db = require("./config/db");

const app = express();
app.use(express.json());
app.use(cors());

// Serve staff static files (CSS, JS, assets)
app.use(express.static(path.join(__dirname, "public")));

// Ensure DB schema exists for staff server as well
db.initDB()
  .then(() => {
    console.log("DB initialized (staff server).");
  })
  .catch((err) => console.error("Staff server DB init failed:", err));

// Import Staff API routes
const staffAuthRoutes = require("./routes/staff_auth");
const staffItemRoutes = require("./routes/staff_items");
const staffInventoryRoutes = require("./routes/staff_inventory");
const staffOrderRoutes = require("./routes/staff_orders");
const staffAdRoutes = require("./routes/staff_ads");
const staffReportRoutes = require("./routes/staff_reports");
const staffLogRoutes = require("./routes/staff_logs");
const staffArchiveRoutes = require("./routes/staff_archive");
const uploadRoutes = require("./routes/upload");
const staffFeedbackRoutes = require("./routes/feedback");
const staffVoucherRoutes = require("./routes/staff_vouchers");
const staffSettingsRoutes = require("./routes/staff_settings");
const staffCanteenRoutes = require("./routes/staff_canteens");
const paymentsExtraRoutes = require("./routes/payments_extra");

// Mount routes (auth stays public for login/register; other staff APIs require token)
app.use("/api/staff/auth", staffAuthRoutes);
let verifyStaffToken;
try {
  verifyStaffToken = require("./routes/staff_middleware").verifyStaffToken;
} catch (e) {
  console.error("Could not load staff middleware:", e.message);
}

if (verifyStaffToken) {
  app.use("/api/staff/items", verifyStaffToken, staffItemRoutes);
  app.use("/api/staff/inventory", verifyStaffToken, staffInventoryRoutes);
  app.use("/api/staff/orders", verifyStaffToken, staffOrderRoutes);
  app.use("/api/staff/ads", verifyStaffToken, staffAdRoutes);
  app.use("/api/staff/reports", verifyStaffToken, staffReportRoutes);
  app.use("/api/staff/logs", verifyStaffToken, staffLogRoutes);
  app.use("/api/staff/archive", verifyStaffToken, staffArchiveRoutes);
  app.use("/api/staff/feedback", verifyStaffToken, staffFeedbackRoutes);
  app.use("/api/staff/vouchers", verifyStaffToken, staffVoucherRoutes);
  app.use("/api/staff/settings", verifyStaffToken, staffSettingsRoutes);
  app.use("/api/staff/canteens", verifyStaffToken, staffCanteenRoutes);
  app.use("/api/upload", verifyStaffToken, uploadRoutes);
  // Mount payment extra (customer-facing) on main API path at customer server mount
  app.use("/api/payments/extra", paymentsExtraRoutes);
} else {
  // Fallback: mount routes without middleware to keep server available
  app.use("/api/staff/items", staffItemRoutes);
  app.use("/api/staff/inventory", staffInventoryRoutes);
  app.use("/api/staff/orders", staffOrderRoutes);
  app.use("/api/staff/ads", staffAdRoutes);
  app.use("/api/staff/reports", staffReportRoutes);
  app.use("/api/staff/logs", staffLogRoutes);
  app.use("/api/staff/archive", staffArchiveRoutes);
  app.use("/api/staff/feedback", staffFeedbackRoutes);
  app.use("/api/staff/vouchers", staffVoucherRoutes);
  app.use("/api/staff/settings", staffSettingsRoutes);
  app.use("/api/staff/canteens", staffCanteenRoutes);
  app.use("/api/upload", uploadRoutes);
}

// Custom route to serve staff dashboard
app.get("/staff", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "staff.html"));
});

// Fallback to staff dashboard
app.get("*", (req, res) => {
  res.redirect("/staff");
});

const PORT = process.env.STAFF_PORT || 5001;
app.listen(PORT, () => {
  console.log(`>>> STAFF PORTAL running at http://localhost:${PORT}`);
});
