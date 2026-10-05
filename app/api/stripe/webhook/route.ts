import { NextResponse } from "next/server";
import Stripe from "stripe";
import { db, init, stripeClient, deliver, discord } from "../../../../lib";

export const runtime = "nodejs";

async function handlePaidSession(session: Stripe.Checkout.Session) {
  const orderId = Number(session.metadata?.order_id || session.client_reference_id);
  if (!Number.isInteger(orderId) || orderId <= 0) throw new Error("Webhook order ID is missing");
  if (session.payment_status !== "paid") return;

  await init();
  const sql = db();

  return sql.begin(async (tx: any) => {
    await tx.unsafe("select pg_advisory_xact_lock($1)", [orderId]);

    const orders = await tx.unsafe(
      "select id,status,minecraft_username,total_cents from orders where id=$1 for update",
      [orderId]
    );
    const order = orders[0];
    if (!order) throw new Error("Order " + orderId + " was not found");
    if (order.status === "delivered") return { alreadyDelivered: true };

    const items = await tx.unsafe(
      "select minecraft_commands from order_items where order_id=$1 order by id",
      [orderId]
    );
    const commands = items.map((x: any) => x.minecraft_commands || "").filter(Boolean).join("\n");
    const paymentId = typeof session.payment_intent === "string" ? session.payment_intent : null;

    await tx.unsafe(
      "update orders set status='paid',payment_id=$1,delivery_attempts=coalesce(delivery_attempts,0)+1,delivery_error=null where id=$2",
      [paymentId, orderId]
    );

    try {
      await deliver(order.minecraft_username, commands);
      await tx.unsafe(
        "update orders set status='delivered',delivered_at=now(),delivery_error=null where id=$1",
        [orderId]
      );
      await discord("✅ OdarisMC order #" + orderId + " delivered to **" + order.minecraft_username + "**.");
      return { delivered: true };
    } catch (error: any) {
      const message = error?.message || "Delivery failed";
      await tx.unsafe(
        "update orders set status='delivery_failed',delivery_error=$1 where id=$2",
        [message.slice(0, 1000), orderId]
      );
      throw new Error(message);
    }
  });
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook secret is not configured" }, { status: 500 });

  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 });

  const body = await request.text();
  let event: Stripe.Event;

  try {
    event = stripeClient().webhooks.constructEvent(body, signature, secret);
  } catch (error: any) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed" ||
        event.type === "checkout.session.async_payment_succeeded") {
      await handlePaidSession(event.data.object as Stripe.Checkout.Session);
    }
    return NextResponse.json({ received: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Webhook processing failed" }, { status: 500 });
  }
}
