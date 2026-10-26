import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { syncAllIntegrations } from "@/lib/integrations/sync";

// Chamado pela Vercel uma vez por dia (vercel.json). A Vercel manda o CRON_SECRET no cabeçalho.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return new NextResponse("Não autorizado", { status: 401 });
  const results = await syncAllIntegrations(45_000);
  return NextResponse.json({ integracoes: results.length, status: results.map((r) => r.status) });
}
