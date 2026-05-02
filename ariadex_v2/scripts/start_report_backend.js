"use strict";

const { startServer } = require("../server/report_backend.js");

async function main() {
  try {
    const { host, port } = await startServer();
    console.log(`[Ariadex v2] Report backend listening on http://${host}:${port}`);
  } catch (error) {
    console.error(`[Ariadex v2] ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
