import { db, init } from "../../lib";
import CheckoutForm from "./CheckoutForm";
export const dynamic = "force-dynamic";

export default async function Checkout({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const params=await searchParams;
  const id=Number(params.product);
  let product:any=null;
  try {
    await init();
    const rows=await db().unsafe("select id,name,description,price_cents,category from products where id=$1 and active=true",[id]);
    product=rows[0]||null;
  } catch {}

  if(!product) return <><h1>Checkout</h1><div className="card"><p className="danger">Product not found.</p></div></>;

  return <>
    <h1>Checkout</h1>
    <div className="card">
      <div className="muted">{product.category}</div>
      <h2>{product.name}</h2>
      <p className="muted">{product.description}</p>
      <div className="price">₹{(product.price_cents/100).toFixed(2)}</div>
      <CheckoutForm productId={product.id}/>
      <p className="muted">Secure Razorpay checkout supports UPI and other payment methods enabled for your Razorpay account. Your Minecraft purchase is delivered only after the signed payment webhook confirms the payment.</p>
    </div>
  </>;
}
