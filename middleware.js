import { NextResponse } from "next/server";

export function middleware(request) {
  if (!request.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.next();
  }
  const origin = request.headers.get("origin");
  const response = NextResponse.next();
  response.headers.set("Access-Control-Allow-Origin", origin || "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, x-product-id"
  );
  response.headers.set("Access-Control-Max-Age", "86400");
  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: response.headers });
  }
  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};