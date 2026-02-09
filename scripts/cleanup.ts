import { connectPool } from "@/db";
import readline from "node:readline";

function confirm(question: string): Promise<boolean> {
  let rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

async function main() {
  let pool = await connectPool("reactivepay_core_production");
  let client = await pool.connect();
  try {
    await client.query("BEGIN");

    let { rows: profiles } = await client.query<{ id: number; email: string }>(
      "SELECT id, email FROM profiles WHERE email LIKE '%@mail.com'"
    );

    if (profiles.length === 0) {
      console.log("No profiles found with email ending in @mail.com");
      await client.query("ROLLBACK");
      return;
    }

    console.log(`\nFound ${profiles.length} profile(s) to delete:\n`);
    console.log("  ID\t| Email");
    console.log("  " + "-".repeat(50));
    for (let p of profiles) {
      console.log(`  ${p.id}\t| ${p.email}`);
    }

    let profile_ids = profiles.map((p) => p.id);

    let wallets_result = await client.query(
      "DELETE FROM wallets WHERE profile_id = ANY($1::int[])",
      [profile_ids]
    );
    console.log(`\n${wallets_result.rowCount} wallet(s) will be deleted.`);

    let profiles_result = await client.query(
      "DELETE FROM profiles WHERE id = ANY($1::int[])",
      [profile_ids]
    );
    console.log(`${profiles_result.rowCount} profile(s) will be deleted.\n`);

    let ok = await confirm("Commit? (y/n): ");
    if (ok) {
      await client.query("COMMIT");
      console.log("Done. Changes committed.");
    } else {
      await client.query("ROLLBACK");
      console.log("Rolled back. No changes were made.");
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error, rolled back:", err);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}

main();
