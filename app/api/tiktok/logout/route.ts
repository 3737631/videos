import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { TIKTOK_COOKIES } from "@/lib/tiktokAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  for (const v of Object.values(TIKTOK_COOKIES)) {
    cookieStore.delete(v);
  }
  cookieStore.delete("tiktok_scope");
  return NextResponse.json({ ok: true });
}

export async function POST() {
  return GET();
}
