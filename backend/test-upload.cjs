const catalyst = require('zcatalyst-sdk-node');
const { Readable } = require('stream');
require('dotenv').config();

const credential = catalyst.credential.refreshToken({
  refresh_token: process.env.ZC_REFRESH_TOKEN,
  client_id: process.env.ZC_CLIENT_ID,
  client_secret: process.env.ZC_CLIENT_SECRET,
});

const app = catalyst.initializeApp({
  projectId: process.env.ZC_PROJECT_ID,
  project_key: process.env.ZC_PROJECT_KEY,
  environment: process.env.ZC_ENVIRONMENT,
  credential,
});

const bucket = app.stratus().bucket(process.env.ZC_STRATUS_BUCKET);

async function run() {
  try {
    console.log("Starting upload...");
    const result = await bucket.putObject("test-upload.png", Buffer.from("hello world"), {
      overwrite: false,
    });
    console.log("Upload result:", result);
  } catch (err) {
    console.log("Error details:", err);
    console.log("Error message:", err.message);
  }
}

run();
