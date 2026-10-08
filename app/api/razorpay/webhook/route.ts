import { NextResponse } from "next/server";
import { db, init, verifyRazorpayWebhook, fetchRazorpayOrder, deliver, discord } from "../../../../lib";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signature=request.headers.get("x-razorpay-signature");
  if(!signature) return NextResponse.json({error:"Missing Razorpay signature"},{status:400});
  const body=await request.text();
  try {
    if(!verifyRazorpayWebhook(body,signature)) return NextResponse.json({error:"Invalid webhook signature"},{status:400});
  } catch(error:any) {
    return NextResponse.json({error:error?.message||"Webhook verification failed"},{status:500});
  }
  try {
    const event=JSON.parse(body);
    if(event.event!=="order.paid") return NextResponse.json({received:true});
    const paidOrder=event.payload?.order?.entity;
    const razorpayOrderId=paidOrder?.id;
    if(!razorpayOrderId) throw new Error("Razorpay order ID is missing");
    await init();
    const sql=db();
    return await sql.begin(async (tx:any)=>{
      const orders=await tx.unsafe("select id,status,minecraft_username,total_cents from orders where razorpay_order_id=$1 for update",[razorpayOrderId]);
      const order=orders[0];
      if(!order) throw new Error("Order was not found");
      if(order.status==="delivered") return NextResponse.json({received:true,alreadyDelivered:true});
      const verified=await fetchRazorpayOrder(razorpayOrderId);
      if(verified.status!=="paid") return NextResponse.json({received:true,paymentPending:true});
      if(Number(verified.amount)!==Number(order.total_cents)||verified.currency!=="INR") throw new Error("Razorpay amount/currency does not match the store order");
      const paymentId=event.payload?.payment?.entity?.id||null;
      await tx.unsafe("update orders set status='paid',payment_id=$1,razorpay_payment_id=$2,delivery_attempts=coalesce(delivery_attempts,0)+1,delivery_error=null where id=$3",[paymentId,paymentId,order.id]);
      const items=await tx.unsafe("select minecraft_commands from order_items where order_id=$1 order by id",[order.id]);
      const commands=items.map((x:any)=>x.minecraft_commands||"").filter(Boolean).join("\n");
      try {
        await deliver(order.minecraft_username,commands);
        await tx.unsafe("update orders set status='delivered',delivered_at=now(),delivery_error=null where id=$1",[order.id]);
        await discord("✅ OdarisMC order #"+order.id+" delivered to **"+order.minecraft_username+"**.");
      } catch(error:any) {
        const message=error?.message||"Delivery failed";
        await tx.unsafe("update orders set status='delivery_failed',delivery_error=$1 where id=$2",[message.slice(0,1000),order.id]);
        throw new Error(message);
      }
      return NextResponse.json({received:true});
    });
  } catch(error:any) {
    return NextResponse.json({error:error?.message||"Webhook processing failed"},{status:500});
  }
}
