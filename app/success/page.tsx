import Link from "next/link";
import { db, init } from "../../lib";
export const dynamic = "force-dynamic";

export default async function Success({ searchParams }: { searchParams: Promise<{ order_id?: string }> }) {
  const params=await searchParams;
  let order:any=null;
  if(params.order_id) {
    try {
      await init();
      const id=Number(params.order_id);
      if(Number.isInteger(id)&&id>0) {
        const rows=await db().unsafe("select id,minecraft_username,status,razorpay_payment_id from orders where id=$1",[id]);
        order=rows[0]||null;
      }
    } catch {}
  }
  return <>
    <h1>Payment submitted</h1>
    <div className="card">
      <h2>{order?"Order #"+order.id:"Thank you!"}</h2>
      <p>Your payment was sent through Razorpay. Your purchase is delivered only after Razorpay's signed webhook confirms the payment.</p>
      {order?<p>Player: <strong>{order.minecraft_username}</strong><br/>Delivery status: <strong>{order.status}</strong></p>:null}
      <p className="muted">If delivery is temporarily unavailable, your order remains recorded for recovery instead of being granted by the browser.</p>
      <Link className="btn" href="/store">Back to store</Link>
    </div>
  </>;
}
