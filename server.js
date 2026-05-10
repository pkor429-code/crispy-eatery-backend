require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

// ââ Middleware ââââââââââââââââââââââââââââââââââââââââââââââ
app.use(cors());
app.use(express.json());

// ââ Order storage ââââââââââââââââââââââââââââââââââââââââââ
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

function nextOrderId() {
  const today = new Date().toISOString().slice(0, 10); // "2026-05-10"
  const orders = loadOrders();
  const todayOrders = orders.filter(
    (o) => o.createdAt && o.createdAt.startsWith(today)
  );
  const num = todayOrders.length + 1;
  return `#${String(num).padStart(3, "0")}`;
}

// ââ Health check âââââââââââââââââââââââââââââââââââââââââââ
app.get("/", (_req, res) => {
  const orders = loadOrders();
  res.json({
    status: "ok",
    mode: "local",
    totalOrders: orders.length,
    note: "Doshii integration pending â orders stored locally",
  });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    mode: "local",
    totalOrders: loadOrders().length,
  });
});

// ââ POST /order â receive order from QR menu ââââââââââââââ
app.post("/order", (req, res) => {
  try {
    const { tableNumber, items, notes, guestCount } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "No items in order" });
    }

    // Build order record
    const order = {
      id: nextOrderId(),
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

    // Save to file
    const orderCount = saveOrder(order);

    // Log to console (visible in Terminal)
    console.log(`\n${"â".repeat(50)}`);
    console.log(`ð NEW ORDER #${order.id}`);
    console.log(`   Table: ${order.tableNumber} | Guests: ${order.guestCount}`);
    console.log(`   Items:`);
    order.items.forEach((item) => {
      console.log(
        `     â¢ ${item.qty}x ${item.name}${item.size ? ` (${item.size})` : ""} â $${item.price.toFixed(2)}${item.notes ? ` [${item.notes}]` : ""}`
      );
    });
    console.log(`   Total: $${order.total.toFixed(2)}`);
    if (order.notes) console.log(`   Notes: ${order.notes}`);
    console.log(`   Time: ${order.createdAt}`);
    console.log(`${"â".repeat(50)}\n`);

    res.json({
      success: true,
      orderId: order.id,
      message: `Order received â Table ${order.tableNumber}`,
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

// ââ Serve kitchen dashboard âââââââââââââââââââââââââââââââ
app.use("/dashboard", express.static(path.join(__dirname, "public")));

// ââ GET /orders â view all orders (staff dashboard) âââââââ
app.get("/orders", (req, res) => {
  let orders = loadOrders();
  // Filter by status (default: show active orders only)
  const status = req.query.status;
  if (status) {
    orders = orders.filter((o) => o.status === status);
  }
  // Filter by table number (for QR menu "add to order")
  const table = req.query.table;
  if (table) {
    orders = orders.filter((o) => String(o.tableNumber) === String(table));
  }
  // Filter orders created after a timestamp (for polling)
  const since = req.query.since;
  if (since) {
    orders = orders.filter((o) => new Date(o.createdAt) > new Date(since));
  }
  res.json({
    count: orders.length,
    orders: orders.reverse(), // newest first
  });
});

// ââ GET /orders/:id â view single order âââââââââââââââââââ
app.get("/orders/:id", (req, res) => {
  const orders = loadOrders();
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

// ââ POST /orders/:id/add-items â add items to existing order
app.post("/orders/:id/add-items", (req, res) => {
  const orders = loadOrders();
  const idx = orders.findIndex((o) => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Order not found" });

  const { items } = req.body;
  if (!items || items.length === 0) {
    return res.status(400).json({ error: "No items to add" });
  }

  // Append new items
  const newItems = items.map((item) => ({
    name: item.name,
    size: item.size || "",
    qty: item.qty || item.quantity || 1,
    price: item.price || 0,
    notes: item.notes || "",
  }));
  orders[idx].items = [...orders[idx].items, ...newItems];

  // Recalculate total
  orders[idx].total = orders[idx].items.reduce(
    (sum, i) => sum + (i.price || 0) * (i.qty || 1),
    0
  );

  // Reset status to received so kitchen sees the update
  orders[idx].status = "received";
  orders[idx].updatedAt = new Date().toISOString();
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));

  // Log to console
  console.log(`\n${"â".repeat(50)}`);
  console.log(`â ITEMS ADDED to ${orders[idx].id} (Table ${orders[idx].tableNumber})`);
  newItems.forEach((item) => {
    console.log(
      `     â¢ ${item.qty}x ${item.name}${item.size ? ` (${item.size})` : ""} â $${item.price.toFixed(2)}${item.notes ? ` [${item.notes}]` : ""}`
    );
  });
  console.log(`   New total: $${orders[idx].total.toFixed(2)}`);
  console.log(`${"â".repeat(50)}\n`);

  res.json({
    success: true,
    orderId: orders[idx].id,
    message: `Items added to order ${orders[idx].id}`,
    total: orders[idx].total,
  });
});

// ââ PATCH /orders/:id â update order status ââââââââââââââ
app.patch("/orders/:id", (req, res) => {
  const orders = loadOrders();
  const idx = orders.findIndex((o) => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Order not found" });

  const { status, cookedItems, pickedItems } = req.body;
  if (!status && cookedItems === undefined && pickedItems === undefined) {
    return res.status(400).json({ error: "Status or item state required" });
  }

  if (status) orders[idx].status = status;
  if (cookedItems !== undefined) orders[idx].cookedItems = cookedItems;
  if (pickedItems !== undefined) orders[idx].pickedItems = pickedItems;
  orders[idx].updatedAt = new Date().toISOString();
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));

  console.log(`[orders] ${orders[idx].id} â ${status}`);
  res.json({ success: true, order: orders[idx] });
});

// ââ DELETE /orders â clear all orders (dev only) ââââââââââ
app.delete("/orders", (_req, res) => {
  fs.writeFileSync(ORDERS_FILE, "[]");
  console.log("[orders] All orders cleared");
  res.json({ success: true, message: "All orders cleared" });
});

// ââ Start server âââââââââââââââââââââââââââââââââââââââââââ
app.listen(PORT, () => {
  const orders = loadOrders();
  console.log(`\nð³ Crispy Eatery backend running on http://localhost:${PORT}`);
  console.log(`   Mode    : Local order storage (Doshii integration pending)`);
  console.log(`   Orders  : ${orders.length} saved`);
  console.log(`\n   Endpoints:`);
  console.log(`     POST  /order       â receive order from QR menu`);
  console.log(`     GET   /orders      â view all orders`);
  console.log(`     PATCH /orders/:id  â update order status`);
  console.log(`     GET   /dashboard   â kitchen dashboard`);
  console.log(`     GET   /health      â health check\n`);
});
