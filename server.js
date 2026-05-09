require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Order storage ──────────────────────────────────────────
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
  const today = new Date().toISOString().slice(0, 10);
  const orders = loadOrders();
  const todayOrders = orders.filter(
    (o) => o.createdAt && o.createdAt.startsWith(today)
  );
  const num = todayOrders.length + 1;
  return `#${String(num).padStart(3, "0")}`;
}

// ── Health check ───────────────────────────────────────────
app.get("/", (_req, res) => {
  const orders = loadOrders();
  res.json({
    status: "ok",
    mode: "local",
    totalOrders: orders.length,
    note: "Doshii integration pending — orders stored locally",
  });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    mode: "local",
    totalOrders: loadOrders().length,
  });
});

// ── POST /order — receive order from QR menu ──────────────
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
    console.log(`\n${"═".repeat(50)}`);
    console.log(`🔔 NEW ORDER #${order.id}`);
    console.log(`   Table: ${order.tableNumber} | Guests: ${order.guestCount}`);
    console.log(`   Items:`);
    order.items.forEach((item) => {
      console.log(
        `     • ${item.qty}x ${item.name}${item.size ? ` (${item.size})` : ""} — $${item.price.toFixed(2)}${item.notes ? ` [${item.notes}]` : ""}`
      );
    });
    console.log(`   Total: $${order.total.toFixed(2)}`);
    if (order.notes) console.log(`   Notes: ${order.notes}`);
    console.log(`   Time: ${order.createdAt}`);
    console.log(`${"═".repeat(50)}\n`);

    res.json({
      success: true,
      orderId: order.id,
      message: `Order received — Table ${order.tableNumber}`,
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

// ── Serve kitchen dashboard ───────────────────────────────
app.use("/dashboard", express.static(path.join(__dirname, "public")));

// ── GET /orders — view all orders (staff dashboard) ───────
app.get("/orders", (req, res) => {
  let orders = loadOrders();
  const status = req.query.status;
  if (status) {
    orders = orders.filter((o) => o.status === status);
  }
  const since = req.query.since;
  if (since) {
    orders = orders.filter((o) => new Date(o.createdAt) > new Date(since));
  }
  res.json({
    count: orders.length,
    orders: orders.reverse(),
  });
});

// ── GET /orders/:id — view single order ───────────────────
app.get("/orders/:id", (req, res) => {
  const orders = loadOrders();
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

// ── PATCH /orders/:id — update order status ──────────────
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

  console.log(`[orders] ${orders[idx].id} → ${status}`);
  res.json({ success: true, order: orders[idx] });
});

// ── DELETE /orders — clear all orders (dev only) ──────────
app.delete("/orders", (_req, res) => {
  fs.writeFileSync(ORDERS_FILE, "[]");
  console.log("[orders] All orders cleared");
  res.json({ success: true, message: "All orders cleared" });
});

// ── Start server ───────────────────────────────────────────
app.listen(PORT, () => {
  const orders = loadOrders();
  console.log(`\n🍳 Crispy Eatery backend running on http://localhost:${PORT}`);
  console.log(`   Mode    : Local order storage (Doshii integration pending)`);
  console.log(`   Orders  : ${orders.length} saved`);
  console.log(`\n   Endpoints:`);
  console.log(`     POST  /order       — receive order from QR menu`);
  console.log(`     GET   /orders      — view all orders`);
  console.log(`     PATCH /orders/:id  — update order status`);
  console.log(`     GET   /dashboard   — kitchen dashboard`);
  console.log(`     GET   /health      — health check\n`);
});
