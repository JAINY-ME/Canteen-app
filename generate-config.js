const fs = require("fs");
const path = require("path");

// Build-time generator for frontend config used by Netlify
const appConfig = {
  API_URL: process.env.API_URL || "http://localhost:5000/api",
  STAFF_API_URL: process.env.STAFF_API_URL || "http://localhost:5001/api/staff",
  SOCKET_URL: process.env.SOCKET_URL || "http://localhost:5000",
};

// Optionally include Firebase config and VAPID key for automated push setup
if (process.env.FIREBASE_CONFIG) {
  try {
    appConfig.firebase = JSON.parse(process.env.FIREBASE_CONFIG);
  } catch (e) {
    console.warn("Invalid FIREBASE_CONFIG JSON, ignoring");
  }
}
if (process.env.FIREBASE_VAPID) {
  appConfig.firebaseVapidKey = process.env.FIREBASE_VAPID;
}

const out = `window.APP_CONFIG = ${JSON.stringify(appConfig, null, 2)};`;
const outPath = path.join(__dirname, "public", "config.js");
fs.writeFileSync(outPath, out, "utf8");
console.log("Wrote", outPath, "with", appConfig);
