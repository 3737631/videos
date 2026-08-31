import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/videos";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
export const config = { matcher: "/" };
