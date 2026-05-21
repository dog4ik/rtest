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
      "SELECT id, email FROM profiles WHERE email LIKE '%@mail.com'",
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

    // Nullify self-referential master_id to avoid FK violation when deleting profiles
    await client.query(
      "UPDATE profiles SET master_id = NULL WHERE master_id = ANY($1::int[])",
      [profile_ids],
    );

    let feeds_result = await client.query(
      "DELETE FROM feeds WHERE agent_id = ANY($1::int[]) OR trader_id = ANY($1::int[])",
      [profile_ids],
    );
    console.log(`\n${feeds_result.rowCount} feed(s) will be deleted.`);

    let disputes_result = await client.query(
      "DELETE FROM disputes WHERE trader_id = ANY($1::int[])",
      [profile_ids],
    );
    console.log(`${disputes_result.rowCount} dispute(s) will be deleted.`);

    let agents_merchants_result = await client.query(
      "DELETE FROM agents_merchants WHERE agent_id = ANY($1::int[]) OR merchant_id = ANY($1::int[])",
      [profile_ids],
    );
    console.log(
      `${agents_merchants_result.rowCount} agents_merchants row(s) will be deleted.`,
    );

    let agents_traders_result = await client.query(
      "DELETE FROM agents_traders WHERE agent_id = ANY($1::int[]) OR trader_id = ANY($1::int[])",
      [profile_ids],
    );
    console.log(
      `${agents_traders_result.rowCount} agents_traders row(s) will be deleted.`,
    );

    let banks_profiles_result = await client.query(
      "DELETE FROM banks_profiles WHERE profile_id = ANY($1::int[])",
      [profile_ids],
    );
    console.log(
      `${banks_profiles_result.rowCount} banks_profiles row(s) will be deleted.`,
    );

    let extra_profile_data_result = await client.query(
      "DELETE FROM extra_profile_data WHERE profile_id = ANY($1::int[])",
      [profile_ids],
    );
    console.log(
      `${extra_profile_data_result.rowCount} extra_profile_data row(s) will be deleted.`,
    );

    let wallets_result = await client.query(
      "DELETE FROM wallets WHERE profile_id = ANY($1::int[])",
      [profile_ids],
    );
    console.log(`${wallets_result.rowCount} wallet(s) will be deleted.`);

    let profiles_result = await client.query(
      "DELETE FROM profiles WHERE id = ANY($1::int[])",
      [profile_ids],
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
