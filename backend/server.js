import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { runScraper, checkFormAccess } from "./index.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI missing in .env");
  process.exit(1);
}
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
const Order = mongoose.model("Order", orderSchema, "form_automation");

// State to keep track of running jobs (for dynamic load logic)
let activeJobs = 0;
const MAX_CONCURRENT_ORDERS = 1;
const jobQueue = [];

function queueJob(orderId, formUrl, numberOfResponses) {
  jobQueue.push({ orderId, formUrl, numberOfResponses });
  // Priority queue: Higher number of responses gets priority
  jobQueue.sort((a, b) => b.numberOfResponses - a.numberOfResponses);
  console.log(`[Queue] Added order ${orderId}. Queue length: ${jobQueue.length}`);
  processQueue();
}

function processQueue() {
  if (activeJobs >= MAX_CONCURRENT_ORDERS || jobQueue.length === 0) return;

  const job = jobQueue.shift();
  startScrapingJob(job.orderId, job.formUrl, job.numberOfResponses);
}

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

  // Check if order already exists for this form
  try {
    const existingOrder = await Order.findOne({ formUrl, status: { $in: ["PENDING", "APPROVED"] } });
    if (existingOrder) {
      return res.status(400).json({ error: "Order already placed" });
    }
  } catch (err) {
    console.error("Error checking existing order:", err);
  }

  // Calculate pricing based on volume
  const calculatePrice = (count) => {
    let multiplier;
    if (count <= 25) {
      multiplier = 3;
    } else if (count <= 50) {
      multiplier = 2.5;
    } else {
      multiplier = 2;
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

    console.log(`[Admin] Order ${orderId} approved. Queuing scraper job...`);

    // Add to global priority queue
    queueJob(orderId, order.formUrl, order.numberOfResponses);

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

async function startScrapingJob(orderId, formUrl, numberOfResponses) {
  // --- Strict RAM Protection for 1GB Server ---
  // Run max 5 at a time for the active order
  const concurrentSubmissions = Math.min(numberOfResponses, 5);
  const delayBetweenSubmissions = 1000;

  const payload = {
    formUrl,
    numberOfResponses: parseInt(numberOfResponses, 10),
    options: {
      delayBetweenSubmissions,
      headless: true, // Must be true on backend to save RAM
      verbose: true,
      concurrentSubmissions,
    }
  };

  activeJobs++;
  console.log(`[Backend] Starting scrape job for ${orderId}. Active orders: ${activeJobs}`);

  try {
    const results = await runScraper(payload);
    console.log(`[Backend] Scrape completed for ${orderId}:`, results);
  } catch (error) {
    console.error(`[Backend] Scrape failed for ${orderId}:`, error);
  } finally {
    activeJobs--;
    processQueue(); // Start next job in queue
  }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
});
