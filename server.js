require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const ORDERS_FILE = path.join(__dirname, "orders.json");

function loadOrders() {
  try {
    if (fs.existsSync(ORDERS_FILE)) {
      return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8"));
    }
  } catch (e) {
    console.error("[orders] Error loading orders file:", e.message);
  }
  return [];
}

function saveOrder(order) {
  const orders = loadOrders();
  orders.push(order);
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
  return orders.length;
}

app.get("/", (_req, res) => {
  const orders = loadOrders();
  res.json({
    status: "ok",
    mode: "local",
    totalOrders: orders.length,
    note: "Doshii integration pending - orders stored locally",
  });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    mode: "local",
    totalOrders: loadOrders().length,
  });
});

app.post("/order", (req, res) => {
  try {
    const { tableNumber, items, notes, guestCount } = req.body;
    if (!items || items.length === 0) {
      return res.status(400).json({ error: "No items in order" });
    }
    const order = {
      id: "ORD-" + Date.now(),
      tableNumber: tableNumber || "?",
      guestCount: guestCount || 1,
      items: items.map((item) => ({
        name: item.name,
        size: item.size || "",
        qty: item.qty || item.quantity || 1,
        price: item.price || 0,
        notes: item.notes || "",
      })),
      notes: notes || "",
      total: items.reduce(
        (sum, i) => sum + (i.price || 0) * (i.qty || i.quantity || 1),
        0
      ),
      status: "received",
      createdAt: new Date().toISOString(),
    };
    const orderCount = saveOrder(order);
    console.log("NEW ORDER #" + order.id);
    console.log("Table: " + order.tableNumber + " | Guests: " + order.guestCount);
    order.items.forEach((item) => {
      console.log("  " + item.qty + "x " + item.name + " - $" + item.price.toFixed(2));
    });
    console.log("Total: $" + order.total.toFixed(2));
    res.json({
      success: true,
      orderId: order.id,
      message: "Order received - Table " + order.tableNumber,
      total: order.total,
    });
  } catch (err) {
    console.error("[order] Error:", err.message);
    res.status(500).json({
      error: "Failed to process order",
      details: err.message,
    });
  }
});

app.get("/orders", (_req, res) => {
  const orders = loadOrders();
  res.json({
    count: orders.length,
    orders: orders.reverse(),
  });
});

app.get("/orders/:id", (req, res) => {
  const orders = loadOrders();
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

app.delete("/orders", (_req, res) => {
  fs.writeFileSync(ORDERS_FILE, "[]");
  console.log("[orders] All orders cleared");
  res.json({ success: true, message: "All orders cleared" });
});

app.listen(PORT, () => {
  const orders = loadOrders();
  console.log("Crispy Eatery backend running on port " + PORT);
  console.log("Mode: Local order storage");
  console.log("Orders: " + orders.length + " saved");
  console.log("Endpoints:");
  console.log("  POST /order  - receive order from QR menu");
  console.log("  GET /orders  - view all orders");
  console.log("  GET /health  - health check");
});
