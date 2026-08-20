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
      product_id TEXT,
      title TEXT,
      price TEXT,
      currency TEXT,
      image TEXT,
      images TEXT,
      seller TEXT,
      store TEXT,
      attributes TEXT,
      conformity TEXT,
      marca TEXT,
      modelo TEXT,
      fabricante TEXT,
      fabricante_email TEXT,
      fabricante_direccion TEXT,
      fabricante_pais TEXT,
      confianza TEXT,
      source TEXT,
      blocked TEXT,
      estado_contacto TEXT,
      created_at TEXT
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      filename TEXT,
      size INTEGER,
      mime TEXT,
      path TEXT,
      created_at TEXT
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_messages (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      email_to TEXT,
      subject TEXT,
      message TEXT,
      video_id TEXT,
      status TEXT,
      created_at TEXT
    );
  `);
  migrate();
  return db;
}

function migrate() {
  const cols = db.prepare("PRAGMA table_info(products)").all().map((c) => c.name);
  const additions = {
    product_id: "TEXT",
    store: "TEXT",
    marca: "TEXT",
    modelo: "TEXT",
    fabricante: "TEXT",
    fabricante_email: "TEXT",
    fabricante_direccion: "TEXT",
    fabricante_pais: "TEXT",
    confianza: "TEXT",
    blocked: "TEXT",
    estado_contacto: "TEXT",
  };
  for (const [column, type] of Object.entries(additions)) {
    if (!cols.includes(column)) {
      db.exec(`ALTER TABLE products ADD COLUMN ${column} ${type}`);
    }
  }
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
    product_id: record.product_id || "",
    title: record.title,
    price: record.price,
    currency: record.currency,
    image: record.image,
    images: safeParse(record.images),
    seller: record.seller,
    store: record.store || record.seller || "",
    attributes: safeParse(record.attributes),
    conformity: safeParse(record.conformity),
    marca: record.marca || "",
    modelo: record.modelo || "",
    fabricante: record.fabricante || "",
    fabricante_email: record.fabricante_email || "",
    fabricante_direccion: record.fabricante_direccion || "",
    fabricante_pais: record.fabricante_pais || "",
    confianza: record.confianza || "no-verificado",
    source: record.source || "mtop",
    blocked: record.blocked || "",
    estado_contacto: record.estado_contacto || "no_contactado",
    created_at: record.created_at,
  };
}

function buildRecord(data) {
  return {
    id: crypto.randomUUID(),
    url: data.url || "",
    product_id: data.product_id || "",
    title: data.title || "",
    price: data.price || "",
    currency: data.currency || "",
    image: data.image || "",
    images: JSON.stringify(data.images || []),
    seller: data.seller || "",
    store: data.store || "",
    attributes: JSON.stringify(data.attributes || []),
    conformity: JSON.stringify(data.conformity || []),
    marca: data.marca || "",
    modelo: data.modelo || "",
    fabricante: data.fabricante || "",
    fabricante_email: data.fabricante_email || "",
    fabricante_direccion: data.fabricante_direccion || "",
    fabricante_pais: data.fabricante_pais || "",
    confianza: data.confianza || "no-verificado",
    source: data.source || "mtop",
    blocked: data.blocked || "",
    estado_contacto: data.estado_contacto || "no_contactado",
    created_at: new Date().toISOString(),
  };
}

async function supabaseClient() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

export async function saveProduct(data) {
  const record = buildRecord(data);

  if (isRemote) {
    const supabase = await supabaseClient();
    const { data: existing, error: findError } = await supabase
      .from("products")
      .select("id")
      .eq("url", record.url)
      .limit(1);
    if (findError) throw new Error(findError.message);
    if (existing && existing.length) {
      const { error } = await supabase
        .from("products")
        .update(record)
        .eq("id", existing[0].id);
      if (error) throw new Error(error.message);
      return normalize({ ...record, id: existing[0].id });
    }
    const { error } = await supabase.from("products").insert(record);
    if (error) throw new Error(error.message);
    return normalize(record);
  }

  const database = await localDb();
  const existing = database.prepare("SELECT id FROM products WHERE url = ?").get(record.url);
  if (existing) {
    const fields = Object.keys(record)
      .filter((k) => k !== "id" && k !== "url")
      .map((k) => `${k} = @${k}`)
      .join(", ");
    const params = {};
    for (const k of Object.keys(record)) {
      if (k !== "id") params[k] = record[k];
    }
    database
      .prepare(`UPDATE products SET ${fields} WHERE url = @url`)
      .run(params);
    return normalize({ ...record, id: existing.id });
  }

  database
    .prepare(
      `INSERT INTO products (id, url, product_id, title, price, currency, image, images, seller, store, attributes, conformity, marca, modelo, fabricante, fabricante_email, fabricante_direccion, fabricante_pais, confianza, source, blocked, estado_contacto, created_at)
       VALUES (@id, @url, @product_id, @title, @price, @currency, @image, @images, @seller, @store, @attributes, @conformity, @marca, @modelo, @fabricante, @fabricante_email, @fabricante_direccion, @fabricante_pais, @confianza, @source, @blocked, @estado_contacto, @created_at)`
    )
    .run(record);
  return normalize(record);
}

export async function getProduct(id) {
  if (isRemote) {
    const supabase = await supabaseClient();
    const { data, error } = await supabase.from("products").select("*").eq("id", id).limit(1);
    if (error) throw new Error(error.message);
    return data && data.length ? normalize(data[0]) : null;
  }
  const row = (await localDb()).prepare("SELECT * FROM products WHERE id = ?").get(id);
  return row ? normalize(row) : null;
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
  const database = await localDb();
  database.prepare("DELETE FROM videos WHERE product_id = ?").run(id);
  database.prepare("DELETE FROM contact_messages WHERE product_id = ?").run(id);
  const result = database.prepare("DELETE FROM products WHERE id = ?").run(id);
  return result.changes > 0;
}

export async function saveVideo(productId, video) {
  const record = {
    id: crypto.randomUUID(),
    product_id: productId || "",
    filename: video.filename,
    size: video.size,
    mime: video.mime,
    path: video.path,
    created_at: new Date().toISOString(),
  };
  (await localDb())
    .prepare(
      "INSERT INTO videos (id, product_id, filename, size, mime, path, created_at) VALUES (@id, @product_id, @filename, @size, @mime, @path, @created_at)"
    )
    .run(record);
  return record;
}

export async function listVideos(productId) {
  const rows = (await localDb())
    .prepare("SELECT id, product_id, filename, size, mime, created_at FROM videos WHERE product_id = ? ORDER BY created_at DESC")
    .all(productId);
  return rows;
}

export async function getVideo(id) {
  const row = (await localDb())
    .prepare("SELECT * FROM videos WHERE id = ?")
    .get(id);
  return row || null;
}

export async function saveMessage(productId, message) {
  const record = {
    id: crypto.randomUUID(),
    product_id: productId || "",
    email_to: message.email_to || "",
    subject: message.subject || "",
    message: message.message || "",
    video_id: message.video_id || "",
    status: message.status || "preparado",
    created_at: new Date().toISOString(),
  };
  (await localDb())
    .prepare(
      "INSERT INTO contact_messages (id, product_id, email_to, subject, message, video_id, status, created_at) VALUES (@id, @product_id, @email_to, @subject, @message, @video_id, @status, @created_at)"
    )
    .run(record);
  return record;
}

export async function getMessages(productId) {
  const rows = (await localDb())
    .prepare("SELECT * FROM contact_messages WHERE product_id = ? ORDER BY created_at DESC")
    .all(productId);
  return rows;
}

export async function updateMessageStatus(id, status) {
  (await localDb()).prepare("UPDATE contact_messages SET status = ? WHERE id = ?").run(status, id);
}

export async function updateContactStatus(productId, estado) {
  (await localDb())
    .prepare("UPDATE products SET estado_contacto = ? WHERE id = ?")
    .run(estado, productId);
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