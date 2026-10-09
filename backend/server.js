import mongoose from "mongoose";
import dotenv from "dotenv";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { runScraper, checkFormAccess } from "./index.js";
import Order from "./models/Order.js";

dotenv.config();

let isConnected = false;

async function connectToDatabase() {
  if (isConnected) return;
  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI missing in .env");
  }
  await mongoose.connect(MONGODB_URI);
  isConnected = true;
  console.log("📦 Connected to MongoDB");
}

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || "us-east-1" });

export const handler = async (event, context) => {
  await connectToDatabase();

  let path = event.rawPath || event.path || "";
  const method = event.requestContext?.http?.method || event.httpMethod || "";

  let body = {};
  if (event.body) {
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (e) {
      console.warn("Could not parse event.body", e);
    }
  }

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-api-secret",
    "Content-Type": "application/json"
  };

  if (method === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  // ---------------------------------------------------------------------------
  // AUTHENTICATION
  // ---------------------------------------------------------------------------
  const providedSecret = event.headers?.['x-api-secret'] || event.headers?.['X-Api-Secret'];
  const expectedSecret = process.env.API_SECRET;

  if (expectedSecret && providedSecret !== expectedSecret) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized: Invalid API Secret" }) };
  }

  try {
    if (path === "/check-form") {
      const { formUrl } = body;
      if (!formUrl) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing formUrl" }) };
      const { requiresLogin } = await checkFormAccess(formUrl);
      return { statusCode: 200, headers, body: JSON.stringify({ requiresLogin }) };
    }

    if (path === "/create-order") {
      const { formUrl, numberOfResponses } = body;
      if (!formUrl || !numberOfResponses) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing formUrl or numberOfResponses" }) };
      }

      const calculatePrice = (count) => {
        let multiplier;
        if (count <= 25) multiplier = 3;
        else if (count <= 50) multiplier = 2.5;
        else multiplier = 2;
        return Math.round(count * multiplier);
      };

      const amount = calculatePrice(numberOfResponses);
      const orderId = `ORD-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

      const newOrder = new Order({
        orderId,
        formUrl,
        numberOfResponses,
        amount
      });
      await newOrder.save();

      console.log(`[Order] Created order ${orderId} for ${numberOfResponses} responses (₹${amount})`);
      return { statusCode: 200, headers, body: JSON.stringify({ id: orderId, amount }) };
    }

    if (path === "/admin/orders") {
      const orders = await Order.find().sort({ createdAt: -1 });
      return { statusCode: 200, headers, body: JSON.stringify(orders) };
    }

    if (path === "/reject") {
      const { orderId } = body;
      const order = await Order.findOne({ orderId });
      if (!order) return { statusCode: 404, headers, body: JSON.stringify({ error: "Order not found" }) };
      if (order.status !== "PENDING") return { statusCode: 400, headers, body: JSON.stringify({ error: "Only PENDING orders can be rejected" }) };

      order.status = "REJECTED";
      await order.save();
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: `Order ${orderId} rejected.` }) };
    }

    if (path === "/retry") {
      const { orderId } = body;
      if (!orderId) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing orderId" }) };

      const order = await Order.findOne({ orderId });
      if (!order) return { statusCode: 404, headers, body: JSON.stringify({ error: "Order not found" }) };

      if ((order.failCount || 0) <= 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "No failures to retry" }) };
      }

      console.log(`[Backend] Retrying ${order.failCount} failed responses for ${orderId}`);
      order.failCount = 0;
      order.status = "APPROVED";
      await order.save();

      // Fall through to /scrap logic so it handles async invocation / local execution correctly!
      path = "/scrap";
    }

    if (path === "/scrap") {
      const { orderId, isInternalRetry } = body;
      if (!orderId) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing orderId" }) };

      const order = await Order.findOne({ orderId });
      if (!order) return { statusCode: 404, headers, body: JSON.stringify({ error: "Order not found" }) };

      // If requested by the frontend initially, instantly return a response and invoke the worker asynchronously
      // This prevents the frontend from timing out waiting for a 15 min lambda
      if (!isInternalRetry && process.env.LAMBDA_TASK_ROOT && process.env.AWS_LAMBDA_FUNCTION_NAME) {
        console.log(`[Admin] Order ${orderId} approved. Triggering async lambda worker...`);
        order.status = "APPROVED";
        await order.save();

        const command = new InvokeCommand({
          FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
          InvocationType: "Event",
          Payload: Buffer.from(JSON.stringify({
            rawPath: "/scrap",
            requestContext: { http: { method: "POST" } },
            headers: { "x-api-secret": process.env.API_SECRET },
            body: JSON.stringify({ orderId: orderId, isInternalRetry: true })
          }))
        });
        await lambdaClient.send(command);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: `Scraping triggered successfully` }) };
      }

      // -------------------------------------------------------------
      // Worker Logic (Runs in background or locally)
      // -------------------------------------------------------------
      if (order.status === "PENDING") {
        order.status = "APPROVED";
        await order.save();
      }

      let remaining = order.numberOfResponses - ((order.successCount || 0) + (order.failCount || 0));
      let isTimeRunningOut = false;

      if (remaining <= 0) {
        console.log(`[Backend] Order ${orderId} already completed (success: ${order.successCount || 0}, fail: ${order.failCount || 0}). Nothing left to do!`);
      } else {
        console.log(`[Backend] Starting/Resuming scrape job for ${orderId}, remaining: ${remaining}`);
      }

      while (remaining > 0) {
        // Lambda max timeout is 15 minutes. Context object provides remaining time.
        // We reserve 90 seconds (90000ms) buffer to safely exit and trigger the next function call.
        const timeRemaining = typeof context.getRemainingTimeInMillis === "function"
          ? context.getRemainingTimeInMillis()
          : 99999999;

        if (timeRemaining < 90000 && process.env.LAMBDA_TASK_ROOT && process.env.AWS_LAMBDA_FUNCTION_NAME) {
          console.log(`[Backend] Time running out (${timeRemaining}ms left). Re-invoking Lambda to continue ${orderId}...`);
          isTimeRunningOut = true;
          const command = new InvokeCommand({
            FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
            InvocationType: "Event",
            Payload: Buffer.from(JSON.stringify({
              rawPath: "/scrap",
              requestContext: { http: { method: "POST" } },
              headers: { "x-api-secret": process.env.API_SECRET },
              body: JSON.stringify({ orderId: orderId, isInternalRetry: true })
            }))
          });
          await lambdaClient.send(command);
          break; // Stop processing this chunk and let the Lambda die gracefully
        }

        // Process in manageable chunks (e.g. 5 at a time)
        const concurrentSubmissions = Math.min(remaining, 5);
        const payload = {
          formUrl: order.formUrl,
          numberOfResponses: concurrentSubmissions,
          options: {
            delayBetweenSubmissions: 1000,
            headless: true, // Must be true in lambda
            verbose: true,
            concurrentSubmissions: concurrentSubmissions,
            onProgress: () => { } // handled after chunk
          }
        };

        const results = await runScraper(payload);

        // Update database with chunk progress
        const updatedOrder = await Order.findOneAndUpdate(
          { orderId },
          { $inc: { successCount: results.successCount || 0, failCount: results.failCount || 0 } },
          { returnDocument: 'after' }
        );

        remaining = updatedOrder.numberOfResponses - ((updatedOrder.successCount || 0) + (updatedOrder.failCount || 0));
        console.log(`[Backend] Finished chunk for ${orderId}. Remaining: ${remaining}`);
      }

      // If the loop finished naturally without timing out, mark as COMPLETED
      if (!isTimeRunningOut && remaining <= 0) {
        await Order.updateOne({ orderId }, { $set: { status: "COMPLETED" } });
        console.log(`[Backend] Job ${orderId} fully completed!`);
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: `Worker cycle finished` }) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: "Endpoint Not Found" }) };

  } catch (err) {
    console.error("Handler error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Internal Server Error" }) };
  }
};
