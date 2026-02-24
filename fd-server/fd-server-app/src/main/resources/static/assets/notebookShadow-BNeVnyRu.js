import{invoke as s}from"./core-BEOw45JP.js";import{listen as y}from"./event-DXqYWlmG.js";import{n as p,C as O}from"./index-CFabjnnt.js";import"./i18n-vendor-DzshczMS.js";import"./react-vendor-ld2qaG1d.js";const E={INPUT:"textarea.query-box-input",CHAT_PAIR:".chat-message-pair",CHAT_PAIR_ALT:'[role="log"] .message-content',BOT_REPLY:".to-user-container .message-text-content",BOT_REPLY_FALLBACK_1:".model-response-text",BOT_REPLY_FALLBACK_2:".response-container",COPY_BUTTON:".xap-copy-to-clipboard",SEND_BUTTON:"button.submit-button:not([disabled])",MENU_BUTTON:'button[aria-label="对话选项"]',CONFIRM_DELETE:"button.yes-button"},N="notebook-selectors";async function g(){try{const h=await O.getSettings(N);if(h){const e=JSON.parse(h);return{...E,...e}}}catch{console.warn("[NotebookShadow] Failed to load custom selectors, using defaults")}return{...E}}let m=Promise.resolve();class R{notebookId;notebookUrl;initialized=!1;constructor(e,t){this.notebookId=e,this.notebookUrl=t}async acquireLock(){await m;let e;return m=new Promise(t=>{e=t}),console.log("[NotebookShadow] Query lock acquired"),()=>{console.log("[NotebookShadow] Query lock released"),e()}}async init(){if(!this.initialized){this.initialized=!0;try{await s("open_notebook_window",{notebookId:this.notebookId,notebookUrl:this.notebookUrl}),await new Promise(e=>setTimeout(e,3e3))}catch(e){throw this.initialized=!1,e}}}buildLogHelper(e){return`
      const log = (msg) => {
        if (window.__TAURI__?.core) {
          window.__TAURI__.core.invoke('forward_shadow_event', {
            event: 'shadow-log',
            payload: '[Shadow:' + '${e}'.slice(-6) + '] ' + msg
          }).catch(() => {});
        }
      };
    `}async injectClearScript(e,t){const r=`
      (async function() {
        const SEL = ${JSON.stringify(e)};
        ${this.buildLogHelper(t)}

        // 标记清理开始
        window.__SHADOW_CLEAR_DONE = false;

        // 清除上一次的 observer
        if (window.__SHADOW_POLL_INTERVAL) {
          clearInterval(window.__SHADOW_POLL_INTERVAL);
          window.__SHADOW_POLL_INTERVAL = null;
        }

        // 重置所有会话状态
        window.__SHADOW_SESSION_ID = "${t}";
        window.__SHADOW_SESSION_ACTIVE = false;
        window.__SHADOW_LAST_TEXT = "";
        window.__SHADOW_LAST_BOT_IDLE = false;
        window.__SHADOW_BOT_RESPONDED = false;
        window.__SHADOW_HEARTBEAT = 0;
        window.__SHADOW_LATEST_RESULT = null;

        async function forceClear() {
           // 先等待 DOM 稳定（页面可能还在渲染历史记录）
           await new Promise(r => setTimeout(r, 1500));

           for (let i = 0; i < 3; i++) {
              const pairs = document.querySelectorAll(SEL.CHAT_PAIR + ', ' + SEL.CHAT_PAIR_ALT);
              if (pairs.length === 0) { log('No history to clear (attempt ' + (i+1) + ')'); return true; }

              log('Found ' + pairs.length + ' pair(s), attempting to clear...');
              const menuBtn = document.querySelector(SEL.MENU_BUTTON) ||
                              Array.from(document.querySelectorAll('button')).find(b => b.innerHTML.includes('more_vert') || b.innerText.includes('more_vert'));
              if (!menuBtn) { log('No menu button found, waiting...'); await new Promise(r => setTimeout(r, 1000)); continue; }

              menuBtn.click();
              await new Promise(r => setTimeout(r, 800));

              const delItem = Array.from(document.querySelectorAll('.mat-mdc-menu-item, [role="menuitem"]')).find(el =>
                 el.innerText.includes('删除对话记录') || el.innerText.includes('Delete') || el.innerText.includes('清除')
              );

              if (delItem) {
                 delItem.click();
                 await new Promise(r => setTimeout(r, 1000));
                 const confirm = document.querySelector(SEL.CONFIRM_DELETE) ||
                                 Array.from(document.querySelectorAll('button')).find(el =>
                                   (el.innerText.includes('删除') || el.innerText.includes('Delete')) && el.classList.contains('mat-mdc-button-base')
                                 );
                 if (confirm) {
                    confirm.click();
                    await new Promise(r => setTimeout(r, 2500));
                    if (document.querySelectorAll(SEL.CHAT_PAIR).length === 0) {
                      log('History cleared successfully');
                      return true;
                    }
                 }
              } else {
                 document.body.click();
              }
              await new Promise(r => setTimeout(r, 1000));
           }
           log('Warning: forceClear did not fully succeed');
           return false;
        }

        log('Process: Pure Cleaning...');
        await forceClear();
        // 标记清理完成
        window.__SHADOW_CLEAR_DONE = true;
        log('Clear script finished, __SHADOW_CLEAR_DONE = true');
      })();
    `;await s("execute_notebook_js",{script:r});const o=15e3,_=500,i=Date.now();for(;Date.now()-i<o;){try{if(await s("execute_notebook_js",{script:"(function(){ return String(!!window.__SHADOW_CLEAR_DONE); })()"})==="true"){console.log(`[NotebookShadow:${t.slice(-6)}] Clear completed in ${Date.now()-i}ms`);return}}catch{}await new Promise(u=>setTimeout(u,_))}console.warn(`[NotebookShadow:${t.slice(-6)}] Clear timeout after ${o}ms, proceeding anyway`)}async injectSendScript(e,t,r){const o=`
      (async function() {
        const SEL = ${JSON.stringify(e)};
        ${this.buildLogHelper(r)}

        // 等待输入框就绪
        let input = null;
        for (let retry = 0; retry < 10; retry++) {
          input = document.querySelector(SEL.INPUT);
          if (input) break;
          log('Waiting for input textarea... attempt ' + (retry + 1));
          await new Promise(r => setTimeout(r, 1000));
        }
        if (!input) { log('FATAL: No input element after retries'); return; }

        // 使用 nativeInputValueSetter 确保 Angular/React 框架能感知值变化
        try {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          nativeSetter.call(input, ${JSON.stringify(t)});
        } catch(e) {
          input.value = ${JSON.stringify(t)};
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        // 模拟键盘事件，某些框架需要
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
        await new Promise(r => setTimeout(r, 800));

        log('Input value set, length=' + input.value.length);

        // 等待发送按钮可用
        let sendBtn = null;
        for (let retry = 0; retry < 10; retry++) {
          sendBtn = document.querySelector(SEL.SEND_BUTTON) ||
                    Array.from(document.querySelectorAll('button')).find(b =>
                      (b.innerHTML.includes('arrow_forward') || b.innerHTML.includes('send')) && !b.disabled
                    );
          if (sendBtn) break;
          log('Waiting for send button... attempt ' + (retry + 1));
          await new Promise(r => setTimeout(r, 500));
        }

        if (sendBtn) {
          sendBtn.click();
          window.__SHADOW_SESSION_ACTIVE = true;
          window.__SHADOW_SEND_FAILED = false;
          log('Send button clicked, message sent');
        } else {
          window.__SHADOW_SEND_FAILED = true;
          log('FATAL: No send button found after retries');
        }
      })();
    `;await s("execute_notebook_js",{script:o})}async waitForAck(e,t,r,o=3e4){const _=Date.now(),i=500;for(;Date.now()-_<o;){const u=`
        (function() {
          const SEL = ${JSON.stringify(e)};
          const pairs = document.querySelectorAll(SEL.CHAT_PAIR);
          const pairCount = pairs.length;
          const inp = document.querySelector(SEL.INPUT);
          const inputReady = inp && !inp.disabled;
          const inputCleared = inp && inp.value.trim().length === 0;

          // 检查最后一个 pair 的 bot 回复是否已完成（copy 按钮出现）
          let botFinished = false;
          if (pairCount >= ${t}) {
            const lastPair = pairs[pairCount - 1];
            const hasCopyBtn = !!lastPair.querySelector(SEL.COPY_BUTTON);
            botFinished = hasCopyBtn || (inputReady && inputCleared);
          }

          return JSON.stringify({
            pairCount: pairCount,
            inputReady: !!inputReady,
            inputCleared: !!inputCleared,
            botFinished: botFinished
          });
        })();
      `;try{const n=await s("execute_notebook_js",{script:u});if(n)try{const l=JSON.parse(n);if(l.pairCount>=t&&l.botFinished)return console.log(`[NotebookShadow:${r.slice(-6)}] Ack received: pairs=${l.pairCount}, inputReady=${l.inputReady}`),!0}catch{}}catch(n){console.warn(`[NotebookShadow:${r.slice(-6)}] waitForAck check failed:`,n)}await new Promise(n=>setTimeout(n,i))}return console.warn(`[NotebookShadow:${r.slice(-6)}] waitForAck timeout after ${o}ms`),!1}async*observeAndRelay(e,t){const r=`
      (function() {
        const SESSION_ID = "${t}";
        const SEL = ${JSON.stringify(e)};
        ${this.buildLogHelper(t)}

        // 清除之前的 observer（如果有）
        if (window.__SHADOW_POLL_INTERVAL) {
          clearInterval(window.__SHADOW_POLL_INTERVAL);
          window.__SHADOW_POLL_INTERVAL = null;
        }

        // 重置观察状态（但不清除会话 ID 和 active 标记）
        window.__SHADOW_LAST_TEXT = "";
        window.__SHADOW_LAST_BOT_IDLE = false;
        window.__SHADOW_BOT_RESPONDED = false;
        window.__SHADOW_HEARTBEAT = 0;
        window.__SHADOW_LATEST_RESULT = null;

        // 等待确认：检查 chat-message-pair 出现（表示消息已发送）
        let pairCheckDone = false;
        let checkCount = 0;
        const pairCheckInterval = setInterval(() => {
          checkCount++;
          const pairs = document.querySelectorAll(SEL.CHAT_PAIR);
          const inp = document.querySelector(SEL.INPUT);
          const inputCleared = inp && inp.value.trim().length === 0;
          if (pairs.length > 0 || inputCleared) {
            log('Message confirmed sent: pairs=' + pairs.length + ', inputCleared=' + inputCleared);
            pairCheckDone = true;
            clearInterval(pairCheckInterval);
          } else if (checkCount > 20) {
            log('Warning: Message send not confirmed after 10s, proceeding anyway');
            pairCheckDone = true;
            clearInterval(pairCheckInterval);
          }
        }, 500);

        // 建立 in-page observer
        window.__SHADOW_POLL_INTERVAL = setInterval(() => {
          if (!window.__SHADOW_SESSION_ACTIVE) return;
          window.__SHADOW_HEARTBEAT = (window.__SHADOW_HEARTBEAT || 0) + 1;
          try {
            const pairs = document.querySelectorAll(SEL.CHAT_PAIR);
            const pairCount = pairs.length;

            if (pairCount === 0) {
              if (window.__SHADOW_HEARTBEAT % 10 === 0) {
                window.__SHADOW_LATEST_RESULT = JSON.stringify({
                  heartbeatOnly: true,
                  heartbeat: window.__SHADOW_HEARTBEAT,
                  pairCount: 0,
                  msg: 'No chat pairs found'
                });
              }
              return;
            }

            const lastPair = pairs[pairCount - 1];

            // 只提取 bot 回复文本
            var botMsgEl = lastPair.querySelector(SEL.BOT_REPLY) ||
                           lastPair.querySelector(SEL.BOT_REPLY_FALLBACK_1) ||
                           lastPair.querySelector(SEL.BOT_REPLY_FALLBACK_2);
            var text;
            if (botMsgEl) {
              text = (botMsgEl.innerText || botMsgEl.textContent || '').trim();
            } else {
              text = (lastPair.innerText || lastPair.textContent || '').trim();
            }

            function isJsonBalanced(str) {
              let open = 0, close = 0;
              for (let ch of str) { if (ch === '[') open++; if (ch === ']') close++; }
              return open > 0 && open === close;
            }

            const balanced = isJsonBalanced(text);
            const inp = document.querySelector(SEL.INPUT);
            const botIdle = inp && !inp.disabled;

            if (!botIdle) window.__SHADOW_BOT_RESPONDED = true;

            const hasCopyBtn = !!lastPair.querySelector(SEL.COPY_BUTTON);
            const isFinished = window.__SHADOW_BOT_RESPONDED && (hasCopyBtn || (balanced && botIdle));

            if (text !== window.__SHADOW_LAST_TEXT || botIdle !== window.__SHADOW_LAST_BOT_IDLE) {
              window.__SHADOW_LAST_TEXT = text;
              window.__SHADOW_LAST_BOT_IDLE = botIdle;
              window.__SHADOW_LATEST_RESULT = JSON.stringify({
                text: text,
                finished: isFinished,
                valid: balanced,
                botIdle: !!botIdle,
                botResponded: !!window.__SHADOW_BOT_RESPONDED,
                heartbeat: window.__SHADOW_HEARTBEAT,
                pairCount: pairCount
              });
            }
          } catch(e) {
            window.__SHADOW_LATEST_RESULT = JSON.stringify({
              error: (e.message || String(e)),
              heartbeat: window.__SHADOW_HEARTBEAT
            });
          }
        }, 500);

        log('In-page observer started (global var mode)');
      })();
    `;await s("execute_notebook_js",{script:r}),await new Promise(n=>setTimeout(n,1e3));try{if(await s("execute_notebook_js",{script:"(function(){ return String(!!window.__SHADOW_SEND_FAILED); })()"})==="true"){console.error("[NotebookShadow] Send failed (button not found), aborting observer"),yield{text:"发送失败：未找到发送按钮，请检查 NotebookLM 页面状态",status:"error"};return}}catch{}const o=`
      (function() {
        try {
          var r = window.__SHADOW_LATEST_RESULT;
          var h = window.__SHADOW_HEARTBEAT || 0;
          var active = !!window.__SHADOW_SESSION_ACTIVE;
          var payload;
          if (r) {
            payload = r;
            window.__SHADOW_LATEST_RESULT = null;
          } else {
            payload = JSON.stringify({ heartbeatOnly: true, heartbeat: h, active: active });
          }
          if (window.__TAURI__ && window.__TAURI__.core) {
            window.__TAURI__.core.invoke('forward_shadow_event', {
              event: 'shadow-result', payload: payload
            }).catch(function() {});
          } else if (window.__TAURI_INTERNALS__) {
            window.__TAURI_INTERNALS__.invoke('forward_shadow_event', {
              event: 'shadow-result', payload: payload
            }).catch(function() {});
          }
        } catch(e) {}
      })();
    `,_=await y("shadow-log",n=>console.log("[Shadow-Remote]",n.payload));let i=null;const u=await y("shadow-result",n=>{i=n.payload});try{let n="",l=0,c=0,d=null;const L=3e3;let w=0,T=-1,S=0;for(;c<240;){try{await s("execute_notebook_js",{script:o}),w=0}catch(a){if(w++,console.warn(`[NotebookShadow] Relay injection failed (${w}):`,a),w>10){console.error("[NotebookShadow] Too many relay failures, aborting");break}}if(await new Promise(a=>setTimeout(a,500)),i)try{const a=JSON.parse(i);if(i=null,a.heartbeat!==void 0&&(a.heartbeat===T?S++:(S=0,T=a.heartbeat)),a.heartbeatOnly){c++,c%20===0&&console.log(`[NotebookShadow] Heartbeat: h=${a.heartbeat}, idle=${c}, active=${a.active}, pairs=${a.pairCount||"?"}`),S>30&&(console.warn("[NotebookShadow] Observer heartbeat stale, re-injecting..."),S=0);continue}if(a.error){console.warn("[NotebookShadow] Observer error:",a.error),c++;continue}const{text:A,finished:b}=a;if(A&&A!==n){l++,n=A,c=0,d=null;const f=l>=2&&b;if(yield{text:A,status:f?"complete":"streaming"},f)break}else b&&n&&!d&&l>=2?(d=Date.now(),console.log("[NotebookShadow] Finished signal received, starting confirmation countdown...")):c++}catch{c++}else c++;if(d&&Date.now()-d>=L){console.log("[NotebookShadow] Finished confirmed after delay, completing."),yield{text:n,status:"complete"};break}if(!n&&l===0&&c>120){console.error("[NotebookShadow] No response in 60s, message likely not sent or input too long"),yield{text:"",status:"error"};break}if(n&&c>60){console.log("[NotebookShadow] Hard timeout (30s silence), completing with last text."),yield{text:n,status:"complete"};break}}}finally{await s("execute_notebook_js",{script:"if(window.__SHADOW_POLL_INTERVAL){clearInterval(window.__SHADOW_POLL_INTERVAL);window.__SHADOW_POLL_INTERVAL=null;}"}).catch(()=>{}),u(),_()}}async getChatPairCount(e){const t=`
      (function() {
        const SEL = ${JSON.stringify(e)};
        return document.querySelectorAll(SEL.CHAT_PAIR).length;
      })();
    `;try{const r=await s("execute_notebook_js",{script:t}),o=parseInt(r,10);return isNaN(o)?0:o}catch{return 0}}async*query(e){if(!p())throw new Error("NotebookLM 回复功能仅在桌面客户端可用");const t=`session_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;console.log(`[NotebookShadow] Starting new query session: ${t}`);const r=await this.acquireLock();try{await this.init();const o=await g();await this.injectClearScript(o,t),await this.injectSendScript(o,e,t),yield{text:"",status:"streaming"},yield*this.observeAndRelay(o,t)}catch(o){yield{text:`影子浏览器异常: ${o instanceof Error?o.message:String(o)}`,status:"error"}}finally{r()}}async*queryMultiRound(e){if(!p())throw new Error("NotebookLM 回复功能仅在桌面客户端可用");if(e.length<=1){yield*this.query(e[0]||"");return}const t=`session_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;console.log(`[NotebookShadow] Starting multi-round session: ${t}, ${e.length} messages`);const r=await this.acquireLock();try{await this.init();const o=await g();await this.injectClearScript(o,t),yield{text:"",status:"streaming"};for(let i=0;i<e.length-1;i++){console.log(`[NotebookShadow:${t.slice(-6)}] Sending intermediate message ${i+1}/${e.length-1}, length=${e[i].length}`);const u=await this.getChatPairCount(o);await this.injectSendScript(o,e[i],t),await this.waitForAck(o,u+1,t,3e4)||console.warn(`[NotebookShadow:${t.slice(-6)}] Intermediate message ${i+1} ack timeout, continuing...`),await new Promise(l=>setTimeout(l,1e3))}const _=e.length-1;console.log(`[NotebookShadow:${t.slice(-6)}] Sending final message, length=${e[_].length}`),await this.injectSendScript(o,e[_],t),yield*this.observeAndRelay(o,t)}catch(o){yield{text:`影子浏览器异常: ${o instanceof Error?o.message:String(o)}`,status:"error"}}finally{r()}}async show(){p()&&(await this.init(),await s("toggle_notebook_window",{visible:!0}))}async hide(){p()&&await s("toggle_notebook_window",{visible:!1})}}export{E as DEFAULT_SELECTORS,R as NotebookShadowService,N as SELECTORS_APP_CODE};
