import{F as y,A as O}from"./index-DN3N1NF8.js";import"./i18n-vendor-CIzwIlQ6.js";import"./react-vendor-BgsFZaaF.js";function E(c){const r=c.trim(),l=A(r);if(l)return l;let o=null;const n=r.lastIndexOf("]");if(n!==-1){for(let t=n-1;t>=0;t--)if(r[t]==="["){const e=r.substring(t,n+1);if(!e.substring(1).trimStart().startsWith('"'))continue;try{const p=JSON.parse(e);if(Array.isArray(p)&&p.length>=2&&typeof p[0]=="string"){o=e;break}}catch{}}}let s=o||r;if(!o){const t=s.indexOf("["),e=s.lastIndexOf("]");t!==-1&&e>t&&(s=s.substring(t,e+1))}try{const t=JSON.parse(s);if(Array.isArray(t)&&t.length>=2&&typeof t[0]=="string")return[t[0],t[1]]}catch{const t=s.match(/\[\s*"([\s\S]*?)"\s*,\s*"([\s\S]*?)"\s*\]/);if(t){const e=t[1].replace(/\\n/g,`
`).replace(/\\"/g,'"'),i=t[2].replace(/\\n/g,`
`).replace(/\\"/g,'"');return[e,i]}}return null}function A(c){let r=c;const l=c.match(/```(?:json)?\s*([\s\S]*?)```/);l&&(r=l[1].trim());const o=r.indexOf("{"),n=r.lastIndexOf("}");if(o===-1||n<=o)return null;const s=r.substring(o,n+1);try{const t=JSON.parse(s);if(typeof t!="object"||t===null||Array.isArray(t))return null;const e=t.targetReply||t.target_reply||t.reply||t.englishReply||t.english_reply||t.enReply||t.en_reply||"",i=t.zhReply||t.zh_reply||t.chineseReply||t.chinese_reply||t.cnReply||t.cn_reply||t.translatedReply||"";if(typeof e=="string"&&typeof i=="string"&&(e.length>0||i.length>0))return[e,i]}catch{}return null}const m=12e3,R=1e4,b=3e4,d=3e3;function C(c,r,l){let o={};try{o=JSON.parse(c.content||"{}")}catch{}let n=`【TICKET SUBJECT】: ${c.subject}
`;if(n+=`【INITIAL DESCRIPTION】: ${y(o?.description||"")||"No description content"}

`,o?.conversations&&o.conversations.length>0){const s=o.conversations,t=`--------------------------------------------------
`,e=[];for(const a of s){const N=String(a.userId),h=O[N],I=h?`AGENT (${h})`:a.incoming?"CUSTOMER":"AGENT",T=a.createdAt||"Unknown Time";let u=y(a.bodyText||"");u.length>d&&(u=u.substring(0,d)+`
...[内容已截断]`),e.push(`[${T}] <${I}>:
${u}
${t}`)}const i=`【DETAILED INTERACTION LOGS】:
`+t,p=b-n.length-i.length;let g=0,f=0;for(let a=e.length-1;a>=0;a--){if(g+e[a].length>p){f=a+1;break}g+=e[a].length}n+=i,f>0&&(n+=`[... 已省略最早的 ${f} 条对话记录 ...]
${t}`);for(let a=f;a<e.length;a++)n+=e[a]}return r&&(n+=`
【PREVIOUS AUDIT FEEDBACK】:
`,n+=`审核意见: ${r}
`,n+=`请根据以上审核反馈改进你的回复，避免重复之前的问题。

`),l?.trackingContext&&(n+=l.trackingContext),n}function _(c,r){const l="--------------------------------------------------",o=c.split(l),n=[];let s="";for(const e of o)s.length+e.length+l.length>r&&s.length>0?(n.push(s.trim()),s=e):s+=(s?l:"")+e;s.trim()&&n.push(s.trim());const t=[];for(const e of n)if(e.length<=r)t.push(e);else for(let i=0;i<e.length;i+=r)t.push(e.substring(i,i+r));return t}function P(c,r){const l=r.replace("${工单内容}",c);if(l.length<=m)return[l];console.log(`[replyHelpers] Content too long (${l.length} chars), splitting into multi-round messages`);const o=r.replace("${工单内容}","").trim(),n=[];n.push("I will send you ticket content in multiple parts. Please reply with just 'OK' after receiving each part. DO NOT generate the final reply until I send the message starting with '[END_OF_INPUT]'.");const s=_(c,R);return s.forEach((t,e)=>{n.push(`[Part ${e+1}/${s.length}]
${t}`)}),n.push(`[END_OF_INPUT]

All ticket content has been sent. Now please follow the instruction below:

${o}`),n}function B(c){const r=E(c);return r?{targetReply:r[0],zhReply:r[1]}:null}export{C as buildReplyContext,P as buildReplyMessages,B as parseReplyOutput};
