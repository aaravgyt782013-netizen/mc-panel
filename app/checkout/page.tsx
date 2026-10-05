import Link from "next/link";
import { db, init } from "../../lib";
export const dynamic = "force-dynamic";

export default async function Checkout({ searchParams }: { searchParams: Promise<{ product?: string; cancelled?: string }> }) {
  const params = await searchParams;
  const id = Number(params.product);
  let product: any = null;
  try {
    await init();
    const rows = await db().unsafe(
      "select id,name,description,price_cents,category from products where id=$1 and active=true",
      [id]
    );
    product = rows[0] || null;
  } catch {}

  if (!product) return <><h1>Checkout</h1><div className="card"><p className="danger">Product not found.</p><Link className="btn" href="/store">Back to store</Link></div></>;

  return <>
    <h1>Checkout</h1>
    {params.cancelled ? <div className="card"><p className="danger">Payment was cancelled. Your order was not delivered.</p></div> : null}
    <div className="card">
      <div className="muted">{product.category}</div>
      <h2>{product.name}</h2>
      <p className="muted">{product.description}</p>
      <div className="price">₹{(product.price_cents / 100).toFixed(2)}</div>
      <form method="post" action="/api/checkout" className="form">
        <input type="hidden" name="product" value={product.id} />
        <label>Minecraft username</label>
        <input name="minecraft_username" required minLength={3} maxLength={16} pattern="[A-Za-z0-9_]{3,16}" placeholder="Your exact Minecraft username" />
        <label>Email (optional)</label>
        <input type="email" name="email" placeholder="For your payment receipt" />
        <button className="btn" type="submit">Continue to secure payment</button>
      </form>
      <p className="muted">Payment is processed by Stripe. Your purchase is delivered only after Stripe confirms the payment.</p>
    </div>
  </>;
}
