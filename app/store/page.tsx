import Link from "next/link";
import { db, init } from "../../lib";
export const dynamic="force-dynamic";
export default async function Store(){
  let p:any[]=[];
  try{await init();p=await db().unsafe("select id,name,description,price_cents,category from products where active=true order by id desc")}catch{}
  return <><h1>OdarisMC Store</h1><p className="muted">Choose a product, enter your Minecraft username, then pay securely through Stripe.</p><div className="grid">{p.length?p.map(x=><div className="card" key={x.id}><div className="muted">{x.category}</div><h2>{x.name}</h2><p className="muted">{x.description}</p><div className="price">₹{(x.price_cents/100).toFixed(2)}</div><Link className="btn" href={"/checkout?product="+x.id}>Buy now</Link></div>):<div className="card"><h2>No products yet</h2><p className="muted">Log in as the owner and add your first product from the Admin page.</p></div>}</div></>;
}