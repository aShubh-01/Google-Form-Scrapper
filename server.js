import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { runScraper, checkFormAccess } from "./index.js";

const app = express();
app.use(cors());
app.use(express.json());

// Connect to MongoDB
const MONGODB_URI = "mongodb+srv://ashubh:shubh010xDmongodb@cluster01.khe8kxx.mongodb.net/smart_expense_tracker";
mongoose.connect(MONGODB_URI)
  .then(() => console.log("📦 Connected to MongoDB"))
  .catch(err => console.error("MongoDB connection error:", err));

// Define Order Schema
const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  formUrl: { type: String, required: true },
  numberOfResponses: { type: Number, required: true },
  amount: { type: Number, required: true },
  status: { type: String, default: "PENDING" }, // PENDING | APPROVED
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model("Order", orderSchema);

// State to keep track of running jobs (for dynamic load logic)
let activeJobs = 0;

// 0. Check Form Accessibility
app.post("/api/check-form", async (req, res) => {
  const { formUrl } = req.body;
  if (!formUrl) return res.status(400).json({ error: "Missing formUrl" });

  try {
    const { requiresLogin } = await checkFormAccess(formUrl);
    res.json({ requiresLogin });
  } catch (err) {
    res.status(500).json({ error: "Failed to verify form status" });
  }
});

// 1. Create a WhatsApp/Manual Order
app.post("/api/create-order", async (req, res) => {
  const { formUrl, numberOfResponses } = req.body;
  
  if (!formUrl || !numberOfResponses) {
    return res.status(400).json({ error: "Missing formUrl or numberOfResponses" });
  }

  // Calculate pricing based on volume
  const calculatePrice = (count) => {
    let multiplier;
    if (count <= 10) {
      multiplier = 3;
    } else if (count <= 50) {
      multiplier = 3 - ((count - 10) / 40) * 1.0;
    } else if (count <= 100) {
      multiplier = 2 - ((count - 50) / 50) * 0.5;
    } else {
      multiplier = 1.5;
    }
    return Math.round(count * multiplier);
  };
  
  const amount = calculatePrice(numberOfResponses);
  const orderId = `ORD-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

  try {
    const newOrder = new Order({
      orderId,
      formUrl,
      numberOfResponses,
      amount
    });
    
    await newOrder.save();

    console.log(`[Order] Created manual order ${orderId} for ${numberOfResponses} responses (₹${amount})`);
    
    return res.json({ 
      id: orderId,
      amount: amount
    });

  } catch (error) {
    console.error("Order creation error:", error);
    res.status(500).json({ error: "Could not create order" });
  }
});

// 2. Admin: Get all orders
app.get("/api/admin/orders", async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

// 3. Admin: Approve order and trigger scraping
app.post("/api/admin/approve/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findOne({ orderId });
    
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status === "APPROVED") return res.status(400).json({ error: "Order already approved" });

    order.status = "APPROVED";
    await order.save();
    
    console.log(`[Admin] Order ${orderId} approved. Starting scraper...`);
    
    // Start scraper in background
    startScrapingJob(order.formUrl, order.numberOfResponses);
    
    res.json({ success: true, message: `Order ${orderId} approved and processing started` });
  } catch (err) {
    console.error("Approval error:", err);
    res.status(500).json({ error: "Failed to approve order" });
  }
});

// 4. Admin: Reject order
app.post("/api/admin/reject/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findOne({ orderId });
    
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== "PENDING") return res.status(400).json({ error: "Only PENDING orders can be rejected" });

    order.status = "REJECTED";
    await order.save();
    
    console.log(`[Admin] Order ${orderId} rejected.`);
    res.json({ success: true, message: `Order ${orderId} rejected.` });
  } catch (err) {
    console.error("Rejection error:", err);
    res.status(500).json({ error: "Failed to reject order" });
  }
});

async function startScrapingJob(formUrl, numberOfResponses) {
  // --- Dynamic Load Configuration ---
  let concurrentSubmissions = 5;
  let delayBetweenSubmissions = 500;

  if (activeJobs > 2) {
    concurrentSubmissions = 2;
    delayBetweenSubmissions = 2000;
  }
  if (numberOfResponses <= 5) {
    concurrentSubmissions = Math.min(numberOfResponses, 2);
  }

  const payload = {
    formUrl,
    numberOfResponses: parseInt(numberOfResponses, 10),
    options: {
      delayBetweenSubmissions,
      headless: true, // always headless on backend
      verbose: true,
      concurrentSubmissions,
    }
  };

  activeJobs++;
  console.log(`[Backend] Starting scrape job. Active jobs: ${activeJobs}`);
  
  try {
    const results = await runScraper(payload);
    console.log("[Backend] Scrape completed:", results);
  } catch (error) {
    console.error("[Backend] Scrape failed:", error);
  } finally {
    activeJobs--;
  }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
});
