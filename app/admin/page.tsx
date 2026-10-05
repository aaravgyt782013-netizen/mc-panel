import { getSession, db, init } from "../../lib";
export const dynamic="force-dynamic";
export default async function Admin(){
  const s=await getSession();
  if(!s||s.role!=="admin")return <><h1>Admin</h1><p className="danger">Admin login required.</p><a className="btn" href="/login">Login</a></>;
  try{
    await init();const x=db();
    const u=await x.unsafe("select count(*)::int n from users"),o=await x.unsafe("select count(*)::int n from orders"),p=await x.unsafe("select count(*)::int n from products where active=true");
    const products=await x.unsafe("select id,name,category,price_cents,minecraft_commands,active from products order by id desc");
    const orders=await x.unsafe("select id,minecraft_username,total_cents,status,delivery_attempts,delivery_error,created_at from orders order by id desc limit 20");
    return <><h1>OdarisMC Admin</h1><div className="grid"><div className="card"><h2>Users</h2><div className="price">{u[0].n}</div></div><div className="card"><h2>Orders</h2><div className="price">{o[0].n}</div></div><div className="card"><h2>Products</h2><div className="price">{p[0].n}</div></div></div>
    <div className="card"><h2>Add product</h2><form method="post" action="/api/admin/products" className="form"><label>Name</label><input name="name" required placeholder="VIP Rank"/><label>Description</label><input name="description" placeholder="30-day VIP rank"/><label>Category</label><input name="category" defaultValue="Ranks"/><label>Price in INR</label><input name="price" type="number" min="1" step="0.01" required placeholder="99"/><label>Minecraft commands (one per line)</label><textarea name="minecraft_commands" required rows={5} placeholder={"lp user {player} parent set vip"}/><button className="btn" type="submit">Create product</button></form><p className="muted">Use <code>{"{player}"}</code> where the buyer's Minecraft username should be inserted.</p></div>
    <h2>Products</h2><div className="grid">{products.map((product:any)=><div className="card" key={product.id}><div className="muted">#{product.id} · {product.category}</div><h3>{product.name}</h3><div className="price">₹{(product.price_cents/100).toFixed(2)}</div><p><code>{product.minecraft_commands}</code></p></div>)}</div>
    <h2>Recent orders</h2><div className="grid">{orders.map((order:any)=><div className="card" key={order.id}><h3>Order #{order.id}</h3><p>Player: <strong>{order.minecraft_username}</strong></p><p>Amount: ₹{(order.total_cents/100).toFixed(2)}</p><p>Status: <strong>{order.status}</strong></p><p className="muted">Delivery attempts: {order.delivery_attempts||0}</p>{order.delivery_error?<p className="danger">{order.delivery_error}</p>:null}</div>)}</div></>;
  }catch{return <p className="danger">DATABASE_URL is not configured or the database could not be reached.</p>}
}