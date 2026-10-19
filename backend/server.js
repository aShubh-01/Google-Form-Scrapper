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
      
      const isValidGoogleForm = /^https?:\/\/(docs\.google\.com\/forms\/|forms\.gle\/)/i.test(formUrl);
      if (!isValidGoogleForm) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid Google Form URL" }) };
      }

      const { requiresLogin } = await checkFormAccess(formUrl);
      return { statusCode: 200, headers, body: JSON.stringify({ requiresLogin }) };
    }

    if (path === "/create-order") {
      const { customerName, formUrl, numberOfResponses } = body;
      if (!customerName || !formUrl || !numberOfResponses) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing customerName, formUrl, or numberOfResponses" }) };
      }

      const isValidGoogleForm = /^https?:\/\/(docs\.google\.com\/forms\/|forms\.gle\/)/i.test(formUrl);
      if (!isValidGoogleForm) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid Google Form URL" }) };
      }

      const calculatePrice = (count) => {
        let rate;
        if (count <= 25) rate = 10;
        else if (count <= 50) rate = 8;
        else if (count <= 75) rate = 6;
        else rate = 5;
        return count * rate;
      };

      const amount = calculatePrice(numberOfResponses);
      const orderId = `ORD-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

      const newOrder = new Order({
        orderId,
        customerName,
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

      // Form-level aggregation (tally of all runs and costs across all orders for each form)
      const formStats = {};
      for (const o of orders) {
        if ((o.successCount || 0) >= (o.numberOfResponses || 0) && (o.failCount || 0) > 0) {
          o.failCount = 0;
          Order.updateOne({ _id: o._id }, { $set: { failCount: 0, status: "COMPLETED" } }).catch(console.error);
        }

        const url = o.formUrl;
        if (!url) continue;
        if (!formStats[url]) {
          formStats[url] = {
            formUrl: url,
            totalOrders: 0,
            totalRevenue: 0,
            totalCostINR: 0,
            totalSuccess: 0,
            totalFailed: 0,
            totalRequested: 0,
            totalRuns: 0
          };
        }
        formStats[url].totalOrders += 1;
        formStats[url].totalRevenue += (o.amount || 0);
        formStats[url].totalCostINR += (o.totalCostINR || 0);
        formStats[url].totalSuccess += Math.min(o.successCount || 0, o.numberOfResponses || 0);
        formStats[url].totalFailed += Math.max(0, (o.numberOfResponses || 0) - (o.successCount || 0));
        formStats[url].totalRequested += (o.numberOfResponses || 0);
        formStats[url].totalRuns += (o.runs?.length || (o.lastRun?.processed ? 1 : 0));
      }

      return { statusCode: 200, headers, body: JSON.stringify({ orders, formStats }) };
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

      if ((order.successCount || 0) >= order.numberOfResponses) {
        order.failCount = 0;
        await order.save();
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Order is already 100% completed. All requested responses succeeded." }) };
      }

      if ((order.failCount || 0) <= 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "No failures to retry" }) };
      }

      console.log(`[Backend] Retrying ${order.failCount} failed responses for ${orderId}`);
      body.isRetry = true;
      path = "/scrap";
    }

    if (path === "/scrap") {
      const { orderId, isInternalRetry, isRetry } = body;
      if (!orderId) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing orderId" }) };

      const order = await Order.findOne({ orderId });
      if (!order) return { statusCode: 404, headers, body: JSON.stringify({ error: "Order not found" }) };

      // If all responses have already succeeded, complete the order and exit
      if ((order.successCount || 0) >= order.numberOfResponses) {
        if (order.failCount > 0 || order.status !== "COMPLETED") {
          order.failCount = 0;
          order.status = "COMPLETED";
          await order.save();
        }
        console.log(`[Backend] Order ${orderId} is already 100% completed (${order.successCount}/${order.numberOfResponses} succeeded). Nothing left to process.`);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: "Order is already 100% completed" }) };
      }

      // If requested by the frontend initially, instantly return a response and invoke the worker asynchronously (on Lambda)
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
            body: JSON.stringify({ orderId, isInternalRetry: true, isRetry })
          }))
        });
        await lambdaClient.send(command);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: `Scraping triggered successfully` }) };
      }

      // -------------------------------------------------------------
      // Worker Logic (Runs in background or locally)
      // -------------------------------------------------------------
      const runType = (isRetry || (order.failCount > 0 && order.successCount > 0)) ? "RETRY" : "INITIAL";
      const targetResponses = runType === "RETRY"
        ? Math.min(order.failCount || (order.numberOfResponses - (order.successCount || 0)), order.numberOfResponses)
        : Math.max(0, order.numberOfResponses - (order.successCount || 0));

      if (targetResponses <= 0) {
        order.failCount = 0;
        order.status = "COMPLETED";
        await order.save();
        console.log(`[Backend] Order ${orderId} already completed. Nothing left to do!`);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: "Nothing left to process" }) };
      }

      if (runType === "RETRY") {
        order.failCount = 0; // Reset fail count for new retry run
      }
      order.status = "APPROVED";
      await order.save();

      console.log(`[Backend] Starting ${runType} run for ${orderId}. Target responses: ${targetResponses}`);

      const runRecord = {
        runId: `RUN-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
        runAt: new Date(),
        type: runType,
        targetResponses,
        processed: 0,
        successCount: 0,
        failCount: 0,
        costINR: 0,
        inputTokens: 0,
        outputTokens: 0,
        candidatesTokens: 0,
        thoughtsTokens: 0,
        calls: 0
      };

      let remaining = targetResponses;
      let isTimeRunningOut = false;

      while (remaining > 0) {
        const timeRemaining = typeof context?.getRemainingTimeInMillis === "function"
          ? context.getRemainingTimeInMillis()
          : 99999999;

        if (timeRemaining < 90000 && process.env.LAMBDA_TASK_ROOT && process.env.AWS_LAMBDA_FUNCTION_NAME) {
          console.log(`[Backend] Time running out (${timeRemaining}ms left). Re-invoking Lambda to continue ${orderId}...`);
          isTimeRunningOut = true;

          // Save run progress
          await Order.updateOne(
            { orderId },
            { 
              $set: { lastRun: runRecord },
              $push: { runs: runRecord }
            }
          );

          const command = new InvokeCommand({
            FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
            InvocationType: "Event",
            Payload: Buffer.from(JSON.stringify({
              rawPath: "/scrap",
              requestContext: { http: { method: "POST" } },
              headers: { "x-api-secret": process.env.API_SECRET },
              body: JSON.stringify({ orderId, isInternalRetry: true, isRetry: true })
            }))
          });
          await lambdaClient.send(command);
          break;
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
            onProgress: () => { }
          }
        };

        const results = await runScraper(payload);

        const chunkSuccess = results.successCount || 0;
        const chunkFail = results.failCount || 0;
        const chunkCost = results.cost?.totalINR || 0;
        const chunkIn = results.cost?.inputTokens || 0;
        const chunkOut = results.cost?.outputTokens || 0;
        const chunkCand = results.cost?.candidatesTokens || 0;
        const chunkThink = results.cost?.thoughtsTokens || 0;
        const chunkCalls = results.cost?.totalCalls || 0;

        // Accumulate into this run
        runRecord.processed += (chunkSuccess + chunkFail);
        runRecord.successCount += chunkSuccess;
        runRecord.failCount += chunkFail;
        runRecord.costINR += chunkCost;
        runRecord.inputTokens += chunkIn;
        runRecord.outputTokens += chunkOut;
        runRecord.candidatesTokens += chunkCand;
        runRecord.thoughtsTokens += chunkThink;
        runRecord.calls += chunkCalls;

        // Update database with chunk progress
        const currentOrder = await Order.findOne({ orderId });
        const newSuccess = Math.min((currentOrder.successCount || 0) + chunkSuccess, currentOrder.numberOfResponses);
        const newFail = (currentOrder.failCount || 0) + chunkFail;

        await Order.updateOne(
          { orderId },
          {
            $set: {
              successCount: newSuccess,
              failCount: newFail,
              lastRun: runRecord,
            },
            $inc: {
              totalCostINR: chunkCost,
              totalInputTokens: chunkIn,
              totalOutputTokens: chunkOut,
              totalCalls: chunkCalls
            }
          }
        );

        remaining = Math.max(0, targetResponses - runRecord.processed);
        console.log(`[Backend] Finished chunk for ${orderId}. Run processed: ${runRecord.processed}/${targetResponses}. Remaining in run: ${remaining}`);
      }

      // If loop completed naturally without timeout
      if (!isTimeRunningOut) {
        const finalOrder = await Order.findOne({ orderId });
        const isFullyDone = (finalOrder.successCount >= finalOrder.numberOfResponses) || remaining <= 0;
        await Order.updateOne(
          { orderId },
          { 
            $set: { 
              status: isFullyDone ? "COMPLETED" : "APPROVED",
              lastRun: runRecord
            },
            $push: { runs: runRecord }
          }
        );
        console.log(`[Backend] Job ${orderId} finished! (Run Succeeded: ${runRecord.successCount}, Run Failed: ${runRecord.failCount}, Run Cost: ₹${runRecord.costINR.toFixed(4)})`);
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: `Worker cycle finished` }) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: "Endpoint Not Found" }) };

  } catch (err) {
    console.error("Handler error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Internal Server Error" }) };
  }
};
