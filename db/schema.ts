import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }), code: text("code").notNull(), name: text("name").notNull(), active: integer("active", { mode: "boolean" }).notNull().default(true), updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("products_code_uq").on(table.code)]);
export const bomItems = sqliteTable("bom_items", {
  id: integer("id").primaryKey({ autoIncrement: true }), productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }), materialCode: text("material_code").notNull(), materialName: text("material_name").notNull(), category: text("category").notNull(), quantity: real("quantity").notNull(), unit: text("unit").notNull().default("unidad"), action: text("action").notNull(),
}, (table) => [uniqueIndex("bom_product_material_action_uq").on(table.productId, table.materialCode, table.action)]);
export const bomSubstitutes = sqliteTable("bom_substitutes", {
  id: integer("id").primaryKey({ autoIncrement: true }), bomItemId: integer("bom_item_id").notNull().references(() => bomItems.id, { onDelete: "cascade" }), materialCode: text("material_code").notNull(), priority: integer("priority").notNull().default(1),
}, (table) => [uniqueIndex("bom_substitute_uq").on(table.bomItemId, table.materialCode)]);
export const stockItems = sqliteTable("stock_items", {
  id: integer("id").primaryKey({ autoIncrement: true }), materialCode: text("material_code").notNull(), materialName: text("material_name").notNull(), category: text("category").notNull(), quantity: real("quantity").notNull().default(0), unit: text("unit").notNull().default("unidad"), updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("stock_material_uq").on(table.materialCode)]);
export const stockDepotItems = sqliteTable("stock_depot_items", {
  id: integer("id").primaryKey({ autoIncrement: true }), materialCode:text("material_code").notNull(), depot:text("depot").notNull(), quantity:real("quantity").notNull().default(0), updatedAt:text("updated_at").notNull(),
},table=>[uniqueIndex("stock_depot_material_uq").on(table.materialCode,table.depot)]);
export const appUsers = sqliteTable("app_users", {
  id: integer("id").primaryKey({ autoIncrement: true }), email: text("email").notNull(), username:text("username"),passwordHash:text("password_hash"),name: text("name").notNull(), role: text("role").notNull().default("planner"), active: integer("active",{mode:"boolean"}).notNull().default(true), permissions: text("permissions").notNull().default("programacion,productos,bom,consumos,stock,faltantes,compras"), updatedAt:text("updated_at").notNull(),
},table=>[uniqueIndex("app_users_email_uq").on(table.email),uniqueIndex("app_users_username_uq").on(table.username)]);
export const monthlyPlanRows = sqliteTable("monthly_plan_rows", {
  id:text("id").primaryKey(),month:text("month").notNull(),productCode:text("product_code").notNull(),productName:text("product_name").notNull(),bottles:real("bottles").notNull(),unitsPerBox:integer("units_per_box").notNull(),notes:text("notes").notNull().default(""),updatedAt:text("updated_at").notNull(),
});
export const incomingMaterials = sqliteTable("incoming_materials", {
  id:text("id").primaryKey(),expectedMonth:text("expected_month").notNull(),materialCode:text("material_code").notNull(),materialName:text("material_name").notNull(),quantity:real("quantity").notNull(),supplier:text("supplier").notNull().default(""),orderReference:text("order_reference").notNull().default(""),notes:text("notes").notNull().default(""),updatedAt:text("updated_at").notNull(),
});
