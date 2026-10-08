"use client";

import { useState } from "react";

declare global {
  interface Window { Razorpay:any; }
}

export default function CheckoutForm({productId}:{productId:number}) {
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");

  async function pay(e:React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const form=new FormData(e.currentTarget);
    try {
      const response=await fetch("/api/checkout",{method:"POST",body:form});
      const data=await response.json();
      if(!response.ok) throw new Error(data.error||"Unable to start payment");
      if(!data.keyId) throw new Error("Razorpay key is not configured");
      const open=()=>{
        const options={
          key:data.keyId,
          amount:data.amount,
          currency:data.currency,
          name:"OdarisMC",
          description:"Minecraft Store Order #"+data.orderId,
          order_id:data.razorpayOrderId,
          prefill:{email:data.email||""},
          theme:{color:"#111827"},
          handler:()=>{ window.location.href="/success?order_id="+encodeURIComponent(data.orderId); },
          modal:{ondismiss:()=>setLoading(false)}
        };
        const rzp=new window.Razorpay(options);
        rzp.on("payment.failed",(response:any)=>{
          setError(response?.error?.description||"Payment failed. Please try again.");
          setLoading(false);
        });
        rzp.open();
      };
      if(!window.Razorpay){
        const script=document.createElement("script");
        script.src="https://checkout.razorpay.com/v1/checkout.js";
        script.onload=open;
        script.onerror=()=>{setError("Razorpay checkout could not load.");setLoading(false);};
        document.body.appendChild(script);
      } else open();
    } catch(err:any) {
      setError(err?.message||"Unable to start payment");
      setLoading(false);
    }
  }

  return <form onSubmit={pay} className="form">
    <label>Minecraft username</label>
    <input name="minecraft_username" required minLength={3} maxLength={16} pattern="[A-Za-z0-9_]{3,16}" placeholder="Your exact Minecraft username"/>
    <label>Email (optional)</label>
    <input type="email" name="email" placeholder="For your payment receipt"/>
    <input type="hidden" name="product" value={productId}/>
    {error?<p className="danger">{error}</p>:null}
    <button className="btn" type="submit" disabled={loading}>{loading?"Opening secure checkout…":"Pay securely with UPI / Card"}</button>
  </form>;
}
