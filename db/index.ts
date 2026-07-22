import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

let schemaReady: Promise<void> | undefined;

async function ensureSchema(database: D1Database) {
  schemaReady ??= (async () => {
    const setupStatements = [
      `CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        active INTEGER DEFAULT 1 NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS products_code_uq ON products (code)",
      `CREATE TABLE IF NOT EXISTS bom_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        product_id INTEGER NOT NULL,
        material_code TEXT NOT NULL,
        material_name TEXT NOT NULL,
        category TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit TEXT DEFAULT 'unidad' NOT NULL,
        action TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS bom_product_material_action_uq ON bom_items (product_id, material_code, action)",
      `CREATE TABLE IF NOT EXISTS bom_substitutes (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        bom_item_id INTEGER NOT NULL,
        material_code TEXT NOT NULL,
        priority INTEGER DEFAULT 1 NOT NULL,
        FOREIGN KEY (bom_item_id) REFERENCES bom_items(id) ON DELETE CASCADE
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS bom_substitute_uq ON bom_substitutes (bom_item_id, material_code)",
      `CREATE TABLE IF NOT EXISTS stock_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        material_code TEXT NOT NULL,
        material_name TEXT NOT NULL,
        category TEXT NOT NULL,
        quantity REAL DEFAULT 0 NOT NULL,
        unit TEXT DEFAULT 'unidad' NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS stock_material_uq ON stock_items (material_code)",
      `CREATE TABLE IF NOT EXISTS stock_depot_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        material_code TEXT NOT NULL,
        depot TEXT NOT NULL,
        quantity REAL DEFAULT 0 NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS stock_depot_material_uq ON stock_depot_items (material_code, depot)",
      `CREATE TABLE IF NOT EXISTS app_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        email TEXT NOT NULL,
        username TEXT,
        password_hash TEXT,
        name TEXT NOT NULL,
        role TEXT DEFAULT 'planner' NOT NULL,
        active INTEGER DEFAULT 1 NOT NULL,
        permissions TEXT DEFAULT 'programacion,productos,bom,consumos,stock,faltantes,compras' NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_uq ON app_users (email)",
      `CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS program_cache (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS monthly_plan_rows (
        id TEXT PRIMARY KEY NOT NULL,
        month TEXT NOT NULL,
        product_code TEXT NOT NULL,
        product_name TEXT NOT NULL,
        bottles REAL NOT NULL,
        units_per_box INTEGER NOT NULL,
        notes TEXT DEFAULT '' NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS incoming_materials (
        id TEXT PRIMARY KEY NOT NULL,
        expected_month TEXT NOT NULL,
        material_code TEXT NOT NULL,
        material_name TEXT NOT NULL,
        quantity REAL NOT NULL,
        supplier TEXT DEFAULT '' NOT NULL,
        order_reference TEXT DEFAULT '' NOT NULL,
        notes TEXT DEFAULT '' NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ];

    await database.batch(setupStatements.map((sql) => database.prepare(sql)));

    const columns = await database.prepare("PRAGMA table_info(app_users)").all<{ name: string }>();
    const names = new Set(columns.results.map((column) => column.name));
    if (!names.has("username")) await database.exec("ALTER TABLE app_users ADD username TEXT;");
    if (!names.has("password_hash")) await database.exec("ALTER TABLE app_users ADD password_hash TEXT;");
    await database.exec("CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_uq ON app_users (username);");
  })().catch((error) => {
    schemaReady = undefined;
    throw error;
  });

  await schemaReady;
}

export async function getDb() {
  const database = await getD1Database();
  return drizzle(database, { schema });
}

export async function getD1Database() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  await ensureSchema(env.DB);
  return env.DB;
}
