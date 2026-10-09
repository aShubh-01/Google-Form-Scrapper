import express from "express";
import cors from "cors";
import { handler } from "./server.js";

const app = express();

// Enable CORS so your local Vite frontend can talk to it
app.use(cors());

// Parse JSON bodies
app.use(express.json());

// Forward every request to your exported Lambda handler
app.use(async (req, res) => {
  // Construct an event object that looks like an AWS API Gateway / Function URL event
  const event = {
    rawPath: req.path,
    requestContext: {
      http: {
        method: req.method
      }
    },
    headers: req.headers,
    body: JSON.stringify(req.body)
  };

  try {
    // Call your Lambda handler
    const result = await handler(event, {});
    
    // Apply returned headers
    if (result.headers) {
      Object.entries(result.headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
    }

    // Send the response back to the frontend
    res.status(result.statusCode || 200).send(result.body);
  } catch (error) {
    console.error("Local Server Error:", error);
    res.status(500).json({ error: "Internal Local Server Error" });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Local dev server running on http://localhost:${PORT}`);
  console.log(`   Forwarding all requests to Lambda handler...`);
});
