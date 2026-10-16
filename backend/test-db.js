import dotenv from "dotenv";
import mongoose from "mongoose";
import Order from "./models/Order.js";

dotenv.config();

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const orders = await Order.find().sort({createdAt: -1}).limit(2);
  console.log(orders);
  process.exit(0);
}
check();
