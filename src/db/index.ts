import type { Project } from "@/project";
import tracing from "@/tracing";
import { Pool } from "pg";
import { z } from "zod";

type Entity = { [k: string]: z.ZodType };

function selectColumns<T extends Entity>(
  table: string,
  schema: z.ZodObject<T>,
) {
  return Object.keys(schema.shape)
    .map((key) => `${table}."${key}"`)
    .join(", ");
}

export async function connectPool(database: string) {
  let pool = new Pool({
    host: "127.0.0.1",
    user: "postgres",
    port: 5432,
    password: "postgres",
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

// Create a type projection from schema can yield sql dynamic select statements
// TODO: Project specific columns filtering
export function sqlProjection<T extends Entity>(
  table_name: string,
  schema: z.ZodObject<T>,
): Queryable<T> {
  return {
    select: (project) => {
      return selectColumns(table_name, schema);
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
    tracing.debug(`executing one query: ${query}`);
    let res = await this.pool.query(query);
    return schema.parse(res.rows[0]);
  }

  async fetch_optional<T extends z.ZodRawShape>(
    schema: z.ZodObject<T>,
    query: string,
  ): Promise<z.infer<typeof schema> | undefined> {
    tracing.debug(`executing optional query: ${query}`);
    let res = await this.pool.query(query);
    if (res.rowCount == 0) return;
    return schema.parse(res.rows[0]);
  }

  async fetch_all<T extends z.ZodRawShape>(
    schema: z.ZodObject<T>,
    query: string,
  ): Promise<z.infer<typeof schema>[]> {
    tracing.debug(`executing many query: ${query}`);
    let res = await this.pool.query(query);
    return z.array(schema).parse(res.rows);
  }

  async now() {
    let res = await this.pool.query(`select now()`);
    return z.date().parse(res.rows[0]);
  }
}
