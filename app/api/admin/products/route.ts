import { NextResponse } from "next/server";
import { db, getSession, init } from "../../../../lib";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "Admin login required" }, { status: 403 });

  try {
    await init();
    const form = await request.formData();
    const name = String(form.get("name") || "").trim();
    const description = String(form.get("description") || "").trim();
    const category = String(form.get("category") || "Ranks").trim() || "Ranks";
    const price = Number(form.get("price"));
    const commands = String(form.get("minecraft_commands") || "").trim();

    if (!name || !Number.isFinite(price) || price <= 0 || !commands) {
      return NextResponse.json({ error: "Name, positive price and at least one Minecraft command are required." }, { status: 400 });
    }

    await db().unsafe(
      "insert into products(name,description,price_cents,category,minecraft_commands,active) values($1,$2,$3,$4,$5,true)",
      [name, description, Math.round(price * 100), category, commands]
    );
    return NextResponse.redirect(new URL("/admin", request.url), 303);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Unable to create product" }, { status: 500 });
  }
}
