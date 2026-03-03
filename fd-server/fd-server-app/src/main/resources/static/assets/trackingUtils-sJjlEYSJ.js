function c(r){const e=new Set,t=/17track\.net[^\s]*?nums=([A-Za-z0-9,]+)/gi;let n;for(;(n=t.exec(r))!==null;)n[1].split(",").forEach(s=>{const i=s.trim();i&&e.add(i)});const a=[/\b(SF\d{13,15})\b/g,/\b(YT\d{13,18})\b/g,/\b(LP\d{14,})\b/g,/\b(\d{10,22})\b/g,/\b([A-Z]{2}\d{9}[A-Z]{2})\b/g];for(const s of a)for(;(n=s.exec(r))!==null;){const i=n[1];i.length>=10&&!/^\d{10}$/.test(i)&&e.add(i)}return[...e]}function o(r,e){const t=["shipping","tracking","delivery","shipped","package","parcel","where is my order","when will i receive","transit","courier","logistics","shipment","track my order","has been shipped","delivery status","estimated delivery","物流","快递","运单","追踪","发货","到货","签收","配送","包裹","揽收","在途","寄件"],n=(r+" "+e).toLowerCase();return t.some(a=>n.includes(a))}function l(r){if(r.length===0)return"";let e=`

【REAL-TIME LOGISTICS STATUS】:
`;e+=`==========================================================
`;for(const t of r)e+=`Tracking Number: ${t.trackingNumber}
`,e+=`Carrier: ${t.carrier}
`,e+=`Status: ${t.status} — ${t.statusDetail}
`,t.lastEvent&&(e+=`Latest Event: [${t.lastUpdateTime}] ${t.lastEvent}
`),t.events.length>0&&(e+=`Recent Events (latest ${Math.min(t.events.length,5)}):
`,t.events.slice(0,5).forEach(n=>{e+=`  • [${n.time}] ${n.description}`,n.location&&(e+=` (${n.location})`),e+=`
`})),e+=`==========================================================
`;return e+=`IMPORTANT: Base your reply on the REAL tracking data above. Do NOT fabricate tracking information.
`,e}export{c as extractTrackingNumbers,l as formatTrackingContext,o as isLogisticsRelated};
