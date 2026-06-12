import { CONFIG } from "@/config";
import type { Project } from "@/project";
import { Pool } from "pg";
import { z } from "zod";

type Entity = { [k: string]: z.ZodType };

function selectColumns(table: string, schema_keys: string[]) {
  return schema_keys.map((key) => `${table}."${key}"`).join(", ");
}

export async function connectPool(database: string) {
  let postgres = CONFIG.urls().postgres;
  let pool = new Pool({
    host: postgres.host,
    user: postgres.user,
    port: postgres.port,
    password: postgres.password,
    database,
    connectionTimeoutMillis: 2_000,
  });
  await pool.connect();
  return pool;
}

export type Queryable<T extends Entity> = {
  schema: z.ZodObject<T>;
  select: (project: Project) => string;
};

/*
 *  Create a type projection from schema can yield sql dynamic select statements
 */
export function sqlProjection<T extends Entity>(
  table_name: string,
  schema: z.ZodObject<T>,
  column_filter?: (project: Project) => string[] | undefined,
): Queryable<T> {
  return {
    select: (project) => {
      let filter = column_filter?.(project) ?? [];
      return selectColumns(
        table_name,
        Object.keys(schema.shape).filter((c) => !filter.includes(c)),
      );
    },
    schema: schema,
  };
}

export class Db {
  constructor(public pool: Pool) {}

  async fetch_one<T extends z.ZodRawShape>(
    schema: z.ZodObject<T>,
    query: string,
  ): Promise<z.infer<typeof schema>> {
    console.log(`executing one query: ${query}`);
    let res = await this.pool.query(query);
    return schema.parse(res.rows[0]);
  }

  async fetch_optional<T extends z.ZodRawShape>(
    schema: z.ZodObject<T>,
    query: string,
  ): Promise<z.infer<typeof schema> | undefined> {
    console.log(`executing optional query: ${query}`);
    let res = await this.pool.query(query);
    if (res.rowCount == 0) return;
    return schema.parse(res.rows[0]);
  }

  async fetch_all<T extends z.ZodRawShape>(
    schema: z.ZodObject<T>,
    query: string,
  ): Promise<z.infer<typeof schema>[]> {
    console.log(`executing many query: ${query}`);
    let res = await this.pool.query(query);
    return z.array(schema).parse(res.rows);
  }

  async now() {
    let res = await this.pool.query(`select now()`);
    return z.date().parse(res.rows[0]);
  }
}
