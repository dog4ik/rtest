import { z } from "zod";
import { Db, sqlProjection } from ".";
import type { Project } from "@/project";
import type { Pool } from "pg";

export const MidSettingsSchema = z.object({
  id: z.int(),
  external_id: z.int(),
  created_at: z.date(),
  is_unique_order_number: z.boolean(),
  settings: z.json(),
});
export type MidSettings = z.infer<typeof MidSettingsSchema>;
export const MidSettingsQuery = sqlProjection("users", MidSettingsSchema);

export class SettingsDb extends Db {
  constructor(
    pool: Pool,
    private project: Project,
  ) {
    super(pool);
  }

  async merchant_settings(mid: number) {
    let query = `select ${MidSettingsQuery.select(this.project)} from users where users.external_id = '${mid}'`;
    return await this.fetch_one(MidSettingsSchema, query);
  }
}
