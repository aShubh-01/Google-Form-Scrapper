import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const runSchema = new mongoose.Schema({
  runId: { type: String },
  runAt: { type: Date, default: Date.now },
  type: { type: String, default: "INITIAL" }, // INITIAL | RETRY
  targetResponses: { type: Number, default: 0 },
  processed: { type: Number, default: 0 },
  successCount: { type: Number, default: 0 },
  failCount: { type: Number, default: 0 },
  costINR: { type: Number, default: 0 },
  inputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  candidatesTokens: { type: Number, default: 0 },
  thoughtsTokens: { type: Number, default: 0 },
  calls: { type: Number, default: 0 }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  customerName: { type: String, required: true },
  formUrl: { type: String, required: true },
  numberOfResponses: { type: Number, required: true },
  amount: { type: Number, required: true },
  status: { type: String, default: "PENDING" }, // PENDING | APPROVED | IN_PROGRESS | COMPLETED | REJECTED
  
  // Total / Cumulative counts for this order
  successCount: { type: Number, default: 0 },
  failCount: { type: Number, default: 0 },

  // AI Costs & Tokens tally across all runs for this order
  totalCostINR: { type: Number, default: 0 },
  totalInputTokens: { type: Number, default: 0 },
  totalOutputTokens: { type: Number, default: 0 },
  totalCalls: { type: Number, default: 0 },

  // Last run specific stats
  lastRun: {
    runId: { type: String },
    runAt: { type: Date },
    type: { type: String, default: "INITIAL" },
    targetResponses: { type: Number, default: 0 },
    processed: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    failCount: { type: Number, default: 0 },
    costINR: { type: Number, default: 0 },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    candidatesTokens: { type: Number, default: 0 },
    thoughtsTokens: { type: Number, default: 0 },
    calls: { type: Number, default: 0 }
  },

  // History of runs
  runs: [runSchema],

  createdAt: { type: Date, default: Date.now }
});

const collectionName = process.env.ENV === "PRODUCTION" ? "orders_prod" : "orders_test";
const Order = mongoose.models.Order || mongoose.model("Order", orderSchema, collectionName);

export default Order;
