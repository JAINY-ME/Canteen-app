const { spawn } = require("child_process");
const path = require("path");

console.log("==================================================");
console.log("   CAMPUS CANTEEN MANAGEMENT SYSTEM LAUNCHER      ");
console.log("==================================================");
console.log("Starting backend servers concurrently...");

// Spawn Customer Server (Port 5000)
const customerProcess = spawn(
  "node",
  [path.join(__dirname, "customer_server.js")],
  {
    stdio: "inherit",
    shell: true,
  },
);

// Spawn Staff Server (Port 5001)
// Force STAFF_PORT=5001 for the staff child process to ensure expected binding
const staffEnv = Object.assign({}, process.env, { STAFF_PORT: "5001" });
const staffProcess = spawn("node", [path.join(__dirname, "staff_server.js")], {
  stdio: "inherit",
  shell: true,
  env: staffEnv,
});

customerProcess.on("error", (err) => {
  console.error("Failed to start Customer Server:", err);
});

staffProcess.on("error", (err) => {
  console.error("Failed to start Staff Server:", err);
});

// Handle termination signals
process.on("SIGINT", () => {
  console.log("\nShutting down servers...");
  customerProcess.kill();
  staffProcess.kill();
  process.exit();
});
