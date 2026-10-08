import postgres from "postgres";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

let sql: any;
export const db = () => sql || (sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 5 }));

export async function init() {
  await db().unsafe(`
    CREATE TABLE IF NOT EXISTS users(id serial primary key,email text unique not null,password_hash text not null,role text default 'customer',created_at timestamptz default now());
    CREATE TABLE IF NOT EXISTS products(id serial primary key,name text not null,description text default '',price_cents int not null,category text default 'Ranks',minecraft_commands text default '',active boolean default true);
    CREATE TABLE IF NOT EXISTS orders(id serial primary key,user_id int references users(id),minecraft_username text not null,total_cents int not null,status text default 'pending',payment_id text,created_at timestamptz default now());
    CREATE TABLE IF NOT EXISTS order_items(id serial primary key,order_id int references orders(id) on delete cascade,product_id int references products(id),price_cents int not null);
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_order_id text;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_payment_id text;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_attempts int default 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_error text;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS minecraft_commands text default '';
    CREATE UNIQUE INDEX IF NOT EXISTS orders_razorpay_order_id_idx ON orders(razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;
  `);
}

const key = () => new TextEncoder().encode(process.env.AUTH_SECRET || "dev-only-secret");

export async function setSession(u:any) {
  const t=await new SignJWT({id:u.id,email:u.email,role:u.role}).setProtectedHeader({alg:"HS256"}).setIssuedAt().setExpirationTime("7d").sign(key());
  (await cookies()).set("session",t,{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:604800});
}
export async function getSession() {
  const t=(await cookies()).get("session")?.value;if(!t)return null;
  try{return(await jwtVerify(t,key())).payload as any}catch{return null}
}
export async function discord(msg:string) {
  if(process.env.DISCORD_WEBHOOK_URL) await fetch(process.env.DISCORD_WEBHOOK_URL,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({content:msg})}).catch(()=>{});
}

function razorpayCredentials() {
  const keyId=process.env.RAZORPAY_KEY_ID;
  const keySecret=process.env.RAZORPAY_KEY_SECRET;
  if(!keyId||!keySecret) throw new Error("Razorpay is not configured");
  return {keyId,keySecret};
}

export function razorpayKeyId() {
  return razorpayCredentials().keyId;
}

export async function createRazorpayOrder(amountCents:number, receipt:string, notes:Record<string,string>) {
  const {keyId,keySecret}=razorpayCredentials();
  const response=await fetch("https://api.razorpay.com/v1/orders",{
    method:"POST",
    headers:{
      Authorization:"Basic "+Buffer.from(keyId+":"+keySecret).toString("base64"),
      "Content-Type":"application/json",
      Accept:"application/json"
    },
    body:JSON.stringify({amount:amountCents,currency:"INR",receipt,notes})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data?.error?.description||"Unable to create Razorpay order");
  return data;
}

export async function fetchRazorpayOrder(orderId:string) {
  const {keyId,keySecret}=razorpayCredentials();
  const response=await fetch("https://api.razorpay.com/v1/orders/"+encodeURIComponent(orderId),{
    headers:{Authorization:"Basic "+Buffer.from(keyId+":"+keySecret).toString("base64"),Accept:"application/json"},
    cache:"no-store"
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data?.error?.description||"Unable to verify Razorpay order");
  return data;
}

export function verifyRazorpayWebhook(body:string, signature:string) {
  const secret=process.env.RAZORPAY_WEBHOOK_SECRET;
  if(!secret) throw new Error("RAZORPAY_WEBHOOK_SECRET is not configured");
  const expected=crypto.createHmac("sha256",secret).update(body).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(signature));
}

export function storeUrl(requestUrl?:string) {
  return (process.env.NEXT_STORE_URL||process.env.NEXT_PUBLIC_STORE_URL||(requestUrl?new URL(requestUrl).origin:"")).replace(/\/$/,"");
}

export async function deliver(player:string,commands:string) {
  const panel=process.env.PTERODACTYL_URL, apiKey=process.env.PTERODACTYL_API_KEY, serverId=process.env.PTERODACTYL_SERVER_ID;
  if(!panel||!apiKey||!serverId)throw new Error("Pterodactyl delivery is not configured");
  const list=commands.split("\n").map(x=>x.trim()).filter(Boolean);
  if(!list.length)throw new Error("This product has no Minecraft delivery commands");
  for(const command of list){
    const response=await fetch(panel.replace(/\/$/,"")+"/api/client/servers/"+encodeURIComponent(serverId)+"/command",{
      method:"POST",
      headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json",Accept:"Application/vnd.pterodactyl.v1+json"},
      body:JSON.stringify({command:command.replaceAll("{player}",player)})
    });
    if(!response.ok){const detail=await response.text().catch(()=>"");throw new Error("Pterodactyl returned "+response.status+(detail?": "+detail.slice(0,300):""))}
  }
}
export {bcrypt};