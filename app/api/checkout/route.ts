import { NextResponse } from "next/server";
import { db, init, getSession, createRazorpayOrder } from "../../../lib";

const validMinecraftUsername = (value: string) => /^[A-Za-z0-9_]{3,16}$/.test(value);

export async function POST(request: Request) {
  try {
    await init();
    const form = await request.formData();
    const productId = Number(form.get("product"));
    const minecraftUsername = String(form.get("minecraft_username") || "").trim();
    const emailValue = String(form.get("email") || "").trim().toLowerCase();

    if (!Number.isInteger(productId) || productId <= 0) return NextResponse.json({ error: "Invalid product" }, { status: 400 });
    if (!validMinecraftUsername(minecraftUsername)) return NextResponse.json({ error: "Enter a valid Minecraft username (3-16 letters, numbers or underscores)." }, { status: 400 });
    if (emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) return NextResponse.json({ error: "Invalid email address" }, { status: 400 });

    const products = await db().unsafe(
      "select id,name,description,price_cents,minecraft_commands from products where id=$1 and active=true",
      [productId]
    );
    const product = products[0];
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    if (product.price_cents < 1) return NextResponse.json({ error: "Product price must be greater than zero" }, { status: 400 });

    const sessionUser = await getSession();
    const email = sessionUser?.email || emailValue || "";
    const userId = sessionUser?.id || null;

    const orderRows = await db().unsafe(
      "insert into orders(user_id,minecraft_username,total_cents,status) values($1,$2,$3,'pending') returning id",
      [userId, minecraftUsername, product.price_cents]
    );
    const orderId = orderRows[0].id;

    await db().unsafe(
      "insert into order_items(order_id,product_id,price_cents,minecraft_commands) values($1,$2,$3,$4)",
      [orderId, product.id, product.price_cents, product.minecraft_commands || ""]
    );

    const razorOrder = await createRazorpayOrder(product.price_cents, "odaris-"+orderId, {
      order_id:String(orderId),
      minecraft_username:minecraftUsername,
      product_id:String(product.id)
    });

    await db().unsafe(
      "update orders set razorpay_order_id=$1 where id=$2",
      [razorOrder.id, orderId]
    );

    return NextResponse.json({
      orderId,
      razorpayOrderId:razorOrder.id,
      amount:razorOrder.amount,
      currency:razorOrder.currency,
      keyId:process.env.RAZORPAY_KEY_ID,
      email
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Unable to start checkout" }, { status: 500 });
  }
}
