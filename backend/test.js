import payload from "./payload.json" with { type: "json" };
import { runScraper } from "./index.js";

async function main() {
  console.log("🚀 Starting test execution using payload.json...\n");
  
  try {
    await runScraper(payload);
    console.log("\n✅ Test execution finished successfully.");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error during execution:", error);
    process.exit(1);
  }
}

main();
