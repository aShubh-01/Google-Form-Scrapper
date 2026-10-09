import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  formUrl: { type: String, required: true },
  numberOfResponses: { type: Number, required: true },
  amount: { type: Number, required: true },
  status: { type: String, default: "PENDING" }, // PENDING | APPROVED | COMPLETED | REJECTED
  successCount: { type: Number, default: 0 },
  failCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const collectionName = process.env.ENV === "PRODUCTION" ? "orders_prod" : "orders_test";
const Order = mongoose.models.Order || mongoose.model("Order", orderSchema, collectionName);

export default Order;
