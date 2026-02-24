import{D as A,E as f,A as $}from"./index-BUzhjR14.js";import"./i18n-vendor-DzshczMS.js";import"./react-vendor-ld2qaG1d.js";const y=12e3,O=1e4,_=3e4,T=3e3;function D(l,n,r){let c={};try{c=JSON.parse(l.content||"{}")}catch{}let t=`【TICKET SUBJECT】: ${l.subject}
`;if(t+=`【INITIAL DESCRIPTION】: ${f(c?.description||"")||"No description content"}

`,c?.conversations&&c.conversations.length>0){const o=c.conversations,i=`--------------------------------------------------
`,e=[];for(const s of o){const N=String(s.userId),p=$[N],I=p?`AGENT (${p})`:s.incoming?"CUSTOMER":"AGENT",d=s.createdAt||"Unknown Time";let u=f(s.bodyText||"");u.length>T&&(u=u.substring(0,T)+`
...[内容已截断]`),e.push(`[${d}] <${I}>:
${u}
${i}`)}const a=`【DETAILED INTERACTION LOGS】:
`+i,E=_-t.length-a.length;let g=0,h=0;for(let s=e.length-1;s>=0;s--){if(g+e[s].length>E){h=s+1;break}g+=e[s].length}t+=a,h>0&&(t+=`[... 已省略最早的 ${h} 条对话记录 ...]
${i}`);for(let s=h;s<e.length;s++)t+=e[s]}return n&&(t+=`
【PREVIOUS AUDIT FEEDBACK】:
`,t+=`审核意见: ${n}
`,t+=`请根据以上审核反馈改进你的回复，避免重复之前的问题。

`),r?.trackingContext&&(t+=r.trackingContext),t}function m(l,n){const r="--------------------------------------------------",c=l.split(r),t=[];let o="";for(const e of c)o.length+e.length+r.length>n&&o.length>0?(t.push(o.trim()),o=e):o+=(o?r:"")+e;o.trim()&&t.push(o.trim());const i=[];for(const e of t)if(e.length<=n)i.push(e);else for(let a=0;a<e.length;a+=n)i.push(e.substring(a,a+n));return i}function L(l,n){const r=n.replace("${工单内容}",l);if(r.length<=y)return[r];console.log(`[replyHelpers] Content too long (${r.length} chars), splitting into multi-round messages`);const c=n.replace("${工单内容}","").trim(),t=[];t.push("I will send you ticket content in multiple parts. Please reply with just 'OK' after receiving each part. DO NOT generate the final reply until I send the message starting with '[END_OF_INPUT]'.");const o=m(l,O);return o.forEach((i,e)=>{t.push(`[Part ${e+1}/${o.length}]
${i}`)}),t.push(`[END_OF_INPUT]

All ticket content has been sent. Now please follow the instruction below:

${c}`),t}function P(l){const n=A(l);return n?{targetReply:n[0],zhReply:n[1]}:null}export{D as buildReplyContext,L as buildReplyMessages,P as parseReplyOutput};
