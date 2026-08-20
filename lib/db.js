import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DatabaseSync } from "node:sqlite";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isRemote = Boolean(SUPABASE_URL && SUPABASE_KEY);

let db = null;

async function localDb() {
  if (db) return db;
  const dataDir = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  db = new DatabaseSync(path.join(dataDir, "app.db"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      url TEXT,
      title TEXT,
      price TEXT,
      currency TEXT,
      image TEXT,
      images TEXT,
      seller TEXT,
      attributes TEXT,
      conformity TEXT,
      source TEXT,
      created_at TEXT
    );
  `);
  return db;
}

function safeParse(value) {
  if (value == null) return [];
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return [];
  }
}

function normalize(record) {
  return {
    id: record.id,
    url: record.url,
    title: record.title,
    price: record.price,
    currency: record.currency,
    image: record.image,
    images: safeParse(record.images),
    seller: record.seller,
    attributes: safeParse(record.attributes),
    conformity: safeParse(record.conformity),
    source: record.source || "mtop",
    created_at: record.created_at,
  };
}

async function supabaseClient() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

export async function saveProduct(data) {
  const record = {
    id: crypto.randomUUID(),
    url: data.url || "",
    title: data.title || "",
    price: data.price || "",
    currency: data.currency || "",
    image: data.image || "",
    images: JSON.stringify(data.images || []),
    seller: data.seller || "",
    attributes: JSON.stringify(data.attributes || []),
    conformity: JSON.stringify(data.conformity || []),
    source: data.source || "mtop",
    created_at: new Date().toISOString(),
  };

  if (isRemote) {
    const supabase = await supabaseClient();
    const { error } = await supabase.from("products").insert(record);
    if (error) throw new Error(error.message);
    return normalize(record);
  }

  const statement = (await localDb()).prepare(`
    INSERT INTO products (id, url, title, price, currency, image, images, seller, attributes, conformity, source, created_at)
    VALUES (@id, @url, @title, @price, @currency, @image, @images, @seller, @attributes, @conformity, @source, @created_at)
  `);
  statement.run(record);
  return normalize(record);
}

export async function listProducts(limit = 100) {
  if (isRemote) {
    const supabase = await supabaseClient();
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data || []).map(normalize);
  }

  const rows = (await localDb())
    .prepare("SELECT * FROM products ORDER BY created_at DESC LIMIT ?")
    .all(limit);
  return rows.map(normalize);
}

export async function deleteProduct(id) {
  if (isRemote) {
    const supabase = await supabaseClient();
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return true;
  }

  const result = (await localDb())
    .prepare("DELETE FROM products WHERE id = ?")
    .run(id);
  return result.changes > 0;
}

export async function dbInfo() {
  const info = {
    mode: isRemote ? "supabase" : "sqlite-local",
    url: SUPABASE_URL || null,
  };
  if (!isRemote) {
    const database = await localDb();
    const count = database.prepare("SELECT COUNT(*) AS n FROM products").get().n;
    info.path = path.join(process.cwd(), "data", "app.db");
    info.count = count;
  }
  return info;
}