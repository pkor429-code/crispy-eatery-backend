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
  var orders = loadOrders();
  orders.push(order);
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
  return orders.length;
}

app.get("/", function(_req, res) {
  var orders = loadOrders();
  res.json({
    status: "ok",
    mode: "local",
    totalOrders: orders.length
  });
});

app.get("/health", function(_req, res) {
  res.json({
    status: "ok",
    mode: "local",
    totalOrders: loadOrders().length
  });
});

app.post("/order", function(req, res) {
  try {
    var tableNumber = req.body.tableNumber;
    var items = req.body.items;
    var notes = req.body.notes;
    var guestCount = req.body.guestCount;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "No items in order" });
    }

    var order = {
      id: "ORD-" + Date.now(),
      tableNumber: tableNumber || "?",
      guestCount: guestCount || 1,
      items: items.map(function(item) {
        return {
          name: item.name,
          size: item.size || "",
          qty: item.qty || item.quantity || 1,
          price: item.price || 0,
          notes: item.notes || ""
        };
      }),
      notes: notes || "",
      total: items.reduce(function(sum, i) {
        return sum + (i.price || 0) * (i.qty || i.quantity || 1);
      }, 0),
      status: "received",
      createdAt: new Date().toISOString()
    };

    var orderCount = saveOrder(order);

    console.log("NEW ORDER #" + order.id);
    console.log("  Table: " + order.tableNumber + " | Guests: " + order.guestCount);
    order.items.forEach(function(item) {
      console.log("  " + item.qty + "x " + item.name + " $" + item.price.toFixed(2));
    });
    console.log("  Total: $" + order.total.toFixed(2));

    res.json({
      success: true,
      orderId: order.id,
      message: "Order received - Table " + order.tableNumber,
      total: order.total
    });
  } catch (err) {
    console.error("[order] Error:", err.message);
    res.status(500).json({
      error: "Failed to process order",
      details: err.message
    });
  }
});

app.use("/dashboard", express.static(path.join(__dirname, "public")));

app.get("/orders", function(req, res) {
  var orders = loadOrders();
  var status = req.query.status;
  if (status) {
    orders = orders.filter(function(o) { return o.status === status; });
  }
  var since = req.query.since;
  if (since) {
    orders = orders.filter(function(o) { return new Date(o.createdAt) > new Date(since); });
  }
  res.json({
    count: orders.length,
    orders: orders.reverse()
  });
});

app.get("/orders/:id", function(req, res) {
  var orders = loadOrders();
  var order = orders.find(function(o) { return o.id === req.params.id; });
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

app.patch("/orders/:id", function(req, res) {
  var orders = loadOrders();
  var idx = orders.findIndex(function(o) { return o.id === req.params.id; });
  if (idx === -1) return res.status(404).json({ error: "Order not found" });

  var status = req.body.status;
  if (!status) return res.status(400).json({ error: "Status required" });

  orders[idx].status = status;
  orders[idx].updatedAt = new Date().toISOString();
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));

  console.log("[orders] " + orders[idx].id + " -> " + status);
  res.json({ success: true, order: orders[idx] });
});

app.delete("/orders", function(_req, res) {
  fs.writeFileSync(ORDERS_FILE, "[]");
  console.log("[orders] All orders cleared");
  res.json({ success: true, message: "All orders cleared" });
});

app.listen(PORT, function() {
  var orders = loadOrders();
  console.log("Crispy Eatery backend running on port " + PORT);
  console.log("  Mode: Local order storage");
  console.log("  Orders: " + orders.length + " saved");
  console.log("  Endpoints:");
  console.log("    POST  /order       - receive order from QR menu");
  console.log("    GET   /orders      - view all orders");
  console.log("    PATCH /orders/:id  - update order status");
  console.log("    GET   /dashboard   - kitchen dashboard");
  console.log("    GET   /health      - health check");
});

