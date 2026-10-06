import { verifyFullFlow } from "../src/lib/services/verify-flow";

async function main() {
  const result = await verifyFullFlow();
  console.log("\n════════════════════════════════════════");
  console.log(" JOBMATCH_AI — FULL FLOW VERIFICATION");
  console.log("════════════════════════════════════════");
  for (const [stage, detail] of Object.entries(result.stages)) {
    console.log(`  ✓ ${stage.padEnd(22)} ${detail}`);
  }
  if (result.errors.length > 0) {
    console.log("\n  ERRORS:");
    for (const e of result.errors) console.log(`  ✗ ${e}`);
    console.log("\n  RESULT: FAILED");
    process.exit(1);
  } else {
    console.log("\n  RESULT: PASSED");
    process.exit(0);
  }
}

main().catch((e) => {
  console.error("Verification crashed:", e);
  process.exit(1);
});
