import Link from "next/link";
import { db, init } from "../../lib";
export const dynamic = "force-dynamic";

export default async function Success({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const params = await searchParams;
  let order: any = null;
  if (params.session_id) {
    try {
      await init();
      const rows = await db().unsafe(
        "select id,minecraft_username,status from orders where stripe_session_id=$1",
        [params.session_id]
      );
      order = rows[0] || null;
    } catch {}
  }
  return <>
    <h1>Payment received</h1>
    <div className="card">
      <h2>{order ? "Order #" + order.id : "Thank you!"}</h2>
      <p>Your payment was sent to Stripe successfully.</p>
      {order ? <p>Player: <strong>{order.minecraft_username}</strong><br />Delivery status: <strong>{order.status}</strong></p> : null}
      <p className="muted">Minecraft delivery is confirmed by the Stripe webhook, not by the browser redirect. If delivery is temporarily unavailable, the order remains recorded for retry.</p>
      <Link className="btn" href="/store">Back to store</Link>
    </div>
  </>;
}
