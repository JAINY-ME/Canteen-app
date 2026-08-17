const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const db = require("./config/db");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(express.json());
app.use(cors());

// Serve customer static files with Cache-Control and ETag headers
app.use(express.static(path.join(__dirname, "public"), {
  maxAge: 86400000, // Cache static assets for 1 day
  etag: true,
  lastModified: true
}));

app.set("io", io);

// Database initialization
db.initDB()
  .then(() => {
    console.log(
      "SQLite Database initialized and tuned for high write performance (WAL).",
    );
  })
  .catch((err) => {
    console.error("Database initialization failed:", err);
  });

// Real-time WebSockets
io.on("connection", (socket) => {
  socket.on("JOIN_CUSTOMER", (customerId) => {
    socket.join(`customer_${customerId}`);
    console.log(`Customer ${customerId} joined room customer_${customerId}`);
  });

  socket.on("JOIN_KITCHEN", (sectionId) => {
    socket.join(`kitchen_section_${sectionId}`);
    socket.join("kitchen_global");
    console.log(`Kitchen staff joined room kitchen_section_${sectionId}`);
  });

  socket.on("JOIN_CASHIER", () => {
    socket.join("cashier_room");
    console.log(`Cashier joined room cashier_room`);
  });
});

// INTERNAL SOCKET TRIGGER ENDPOINT FOR STAFF CONNECTIVITY
app.post("/api/internal/trigger-socket", (req, res) => {
  const { event, room, data } = req.body;
  if (!event)
    return res
      .status(400)
      .json({ success: false, error: "Missing event name" });

  if (room) {
    io.to(room).emit(event, data);
  } else {
    io.emit(event, data);
  }
  res.json({ success: true });
});

// Import API routes
const customerRoutes = require("./routes/customer");
const menuRoutes = require("./routes/menu");
const orderRoutes = require("./routes/orders");
const paymentRoutes = require("./routes/payments");
const paymentsExtraRoutes = require("./routes/payments_extra");
const receiptRoutes = require("./routes/receipt");
const notificationRoutes = require("./routes/notifications");
const pushRoutes = require("./routes/push_notifications");
const feedbackRoutes = require("./routes/feedback");
const adRoutes = require("./routes/ads");
const uploadRoutes = require("./routes/upload");

// Import Staff API routes
const staffAuthRoutes = require("./routes/staff_auth");
const staffItemRoutes = require("./routes/staff_items");
const staffInventoryRoutes = require("./routes/staff_inventory");
const staffOrderRoutes = require("./routes/staff_orders");
const staffAdRoutes = require("./routes/staff_ads");
const staffReportRoutes = require("./routes/staff_reports");
const staffLogRoutes = require("./routes/staff_logs");
const staffArchiveRoutes = require("./routes/staff_archive");
const staffVoucherRoutes = require("./routes/staff_vouchers");
const staffSettingsRoutes = require("./routes/staff_settings");
const staffCanteenRoutes = require("./routes/staff_canteens");
const staffDevRoutes = require("./routes/staff_dev");
const { verifyStaffToken } = require("./routes/staff_middleware");

// Mount customer routes
app.use("/api/customers", customerRoutes);
app.use("/api/menu", menuRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/payments", paymentsExtraRoutes);
app.use("/api/receipt", receiptRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/ads", adRoutes);
app.use("/api/upload", uploadRoutes);

// Mount staff routes
app.use("/api/staff/auth", staffAuthRoutes);
app.use("/api/staff/items", verifyStaffToken, staffItemRoutes);
app.use("/api/staff/inventory", verifyStaffToken, staffInventoryRoutes);
app.use("/api/staff/orders", verifyStaffToken, staffOrderRoutes);
app.use("/api/staff/ads", verifyStaffToken, staffAdRoutes);
app.use("/api/staff/reports", verifyStaffToken, staffReportRoutes);
app.use("/api/staff/logs", verifyStaffToken, staffLogRoutes);
app.use("/api/staff/archive", verifyStaffToken, staffArchiveRoutes);
app.use("/api/staff/feedback", verifyStaffToken, feedbackRoutes); // customer feedback table is shared
app.use("/api/staff/vouchers", verifyStaffToken, staffVoucherRoutes);
app.use("/api/staff/settings", verifyStaffToken, staffSettingsRoutes);
app.use("/api/staff/canteens", verifyStaffToken, staffCanteenRoutes);
app.use("/api/staff/dev", staffDevRoutes);
app.use("/api/upload", verifyStaffToken, uploadRoutes); // staff local file upload path

// Fetch active canteen list
app.get("/api/canteens/list", async (req, res) => {
  try {
    const rows = await db.all(
      "SELECT * FROM canteens WHERE is_active = 1 ORDER BY canteen_name ASC",
    );
    res.json({ success: true, canteens: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fetch customer ratings & feedbacks summary
app.get("/api/feedback/summary", async (req, res) => {
  try {
    const ratingObj = await db.get(
      "SELECT AVG(rating) as avgRating, COUNT(*) as count FROM ratings",
    );
    const reviews = await db.all(
      `SELECT r.rating, r.review, r.created_at, c.full_name as customer_name 
             FROM ratings r
             JOIN customers c ON r.customer_id = c.customer_id
             WHERE r.review IS NOT NULL AND r.review != ''
             ORDER BY r.created_at DESC LIMIT 5`,
    );
    res.json({
      success: true,
      avgRating: ratingObj ? ratingObj.avgRating || 0.0 : 0.0,
      ratingCount: ratingObj ? ratingObj.count || 0 : 0,
      reviews,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fallback to customer portal index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`>>> CUSTOMER PORTAL running at http://localhost:${PORT}`);
});
