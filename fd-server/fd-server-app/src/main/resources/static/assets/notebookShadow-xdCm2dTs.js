import{invoke as a}from"./core-BEOw45JP.js";import{l as m}from"./event-C7SUnCvf.js";import{x as R,y as b}from"./index-DN3N1NF8.js";import"./i18n-vendor-CIzwIlQ6.js";import"./react-vendor-BgsFZaaF.js";const N={INPUT:"textarea.query-box-input",CHAT_PAIR:".chat-message-pair",CHAT_PAIR_ALT:'[role="log"] .message-content',BOT_REPLY:".to-user-container .message-text-content",BOT_REPLY_FALLBACK_1:".model-response-text",BOT_REPLY_FALLBACK_2:".response-container",COPY_BUTTON:".xap-copy-to-clipboard",SEND_BUTTON:"button.submit-button:not([disabled])",MENU_BUTTON:'button[aria-label="对话选项"]',CONFIRM_DELETE:"button.yes-button"},k="notebook-selectors";let L=Promise.resolve();class x{notebookId;notebookUrl;initialized=!1;config;constructor(t,e,n){this.notebookId=t,this.notebookUrl=e,this.config=n||{}}async loadSelectors(){let t={...N};this.config.selectors&&(t={...t,...this.config.selectors});try{const e=await R.getSettings(k);if(e){const n=JSON.parse(e);t={...t,...n}}}catch{console.warn("[NotebookShadow] Failed to load custom selectors, using defaults")}return t}async acquireLock(){await L;let t;return L=new Promise(e=>{t=e}),console.log("[NotebookShadow] Query lock acquired"),()=>{console.log("[NotebookShadow] Query lock released"),t()}}async init(){if(!this.initialized){this.initialized=!0;try{await a("open_notebook_window",{notebookId:this.notebookId,notebookUrl:this.notebookUrl});const t=this.config.timeouts?.pageLoadMs??3e3;await new Promise(e=>setTimeout(e,t))}catch(t){throw this.initialized=!1,t}}}buildLogHelper(t){return`
      const log = (msg) => {
        if (window.__TAURI__?.core) {
          window.__TAURI__.core.invoke('forward_shadow_event', {
            event: 'shadow-log',
            payload: '[Shadow:' + '${t}'.slice(-6) + '] ' + msg
          }).catch(() => {});
        }
      };
    `}async injectClearScript(t,e){const n=this.config.clearConfig?.enabled??!0,o=this.config.clearConfig?.maxRetries??3,u=this.config.clearConfig?.waitAfterDeleteMs??2500,s=this.config.timeouts?.clearMaxMs??15e3;if(!n){const S=`
        (function() {
          window.__SHADOW_CLEAR_DONE = true;
          window.__SHADOW_SESSION_ID = "${e}";
          window.__SHADOW_SESSION_ACTIVE = false;
          window.__SHADOW_LAST_TEXT = "";
          window.__SHADOW_LAST_BOT_IDLE = false;
          window.__SHADOW_BOT_RESPONDED = false;
          window.__SHADOW_HEARTBEAT = 0;
          window.__SHADOW_LATEST_RESULT = null;
          if (window.__SHADOW_POLL_INTERVAL) {
            clearInterval(window.__SHADOW_POLL_INTERVAL);
            window.__SHADOW_POLL_INTERVAL = null;
          }
        })();
      `;await a("execute_notebook_js",{script:S}),console.log(`[NotebookShadow:${e.slice(-6)}] Clear disabled, state reset only`);return}const d=`
      (async function() {
        const SEL = ${JSON.stringify(t)};
        const MAX_RETRIES = ${o};
        const WAIT_AFTER_DELETE_MS = ${u};
        ${this.buildLogHelper(e)}

        // 标记清理开始
        window.__SHADOW_CLEAR_DONE = false;
        window.__SHADOW_CLEAR_ABORT = false;

        // 清除上一次的 observer
        if (window.__SHADOW_POLL_INTERVAL) {
          clearInterval(window.__SHADOW_POLL_INTERVAL);
          window.__SHADOW_POLL_INTERVAL = null;
        }

        // 重置所有会话状态
        window.__SHADOW_SESSION_ID = "${e}";
        window.__SHADOW_SESSION_ACTIVE = false;
        window.__SHADOW_LAST_TEXT = "";
        window.__SHADOW_LAST_BOT_IDLE = false;
        window.__SHADOW_BOT_RESPONDED = false;
        window.__SHADOW_HEARTBEAT = 0;
        window.__SHADOW_LATEST_RESULT = null;

        async function forceClear() {
           // 先等待 DOM 稳定（页面可能还在渲染历史记录）
           await new Promise(r => setTimeout(r, 1500));

           for (let i = 0; i < MAX_RETRIES; i++) {
              // 检查是否已被外部中止（超时后会设置此标记）
              if (window.__SHADOW_CLEAR_ABORT) { log('Clear aborted by timeout'); return false; }

              const pairs = document.querySelectorAll(SEL.CHAT_PAIR + ', ' + SEL.CHAT_PAIR_ALT);
              if (pairs.length === 0) { log('No history to clear (attempt ' + (i+1) + ')'); return true; }

              log('Found ' + pairs.length + ' pair(s), attempting to clear...');
              const menuBtn = document.querySelector(SEL.MENU_BUTTON) ||
                              Array.from(document.querySelectorAll('button')).find(b => b.innerHTML.includes('more_vert') || b.innerText.includes('more_vert'));
              if (!menuBtn) { log('No menu button found, waiting...'); await new Promise(r => setTimeout(r, 1000)); continue; }

              if (window.__SHADOW_CLEAR_ABORT) { log('Clear aborted by timeout'); return false; }
              menuBtn.click();
              await new Promise(r => setTimeout(r, 800));
              if (window.__SHADOW_CLEAR_ABORT) { log('Clear aborted by timeout'); return false; }

              const delItem = Array.from(document.querySelectorAll('.mat-mdc-menu-item, [role="menuitem"]')).find(el =>
                 el.innerText.includes('删除对话记录') || el.innerText.includes('Delete') || el.innerText.includes('清除')
              );

              if (delItem) {
                 if (window.__SHADOW_CLEAR_ABORT) { log('Clear aborted by timeout'); return false; }
                 delItem.click();
                 await new Promise(r => setTimeout(r, 1000));
                 if (window.__SHADOW_CLEAR_ABORT) { log('Clear aborted by timeout'); return false; }
                 const confirm = document.querySelector(SEL.CONFIRM_DELETE) ||
                                 Array.from(document.querySelectorAll('button')).find(el =>
                                   (el.innerText.includes('删除') || el.innerText.includes('Delete')) && el.classList.contains('mat-mdc-button-base')
                                 );
                 if (confirm) {
                    if (window.__SHADOW_CLEAR_ABORT) { log('Clear aborted by timeout'); return false; }
                    confirm.click();
                    await new Promise(r => setTimeout(r, WAIT_AFTER_DELETE_MS));
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
    `;await a("execute_notebook_js",{script:d});const w=s,l=500,c=Date.now();for(;Date.now()-c<w;){try{if(await a("execute_notebook_js",{script:"(function(){ return String(!!window.__SHADOW_CLEAR_DONE); })()"})==="true"){console.log(`[NotebookShadow:${e.slice(-6)}] Clear completed in ${Date.now()-c}ms`);return}}catch{}await new Promise(S=>setTimeout(S,l))}console.warn(`[NotebookShadow:${e.slice(-6)}] Clear timeout after ${w}ms, proceeding anyway`);try{await a("execute_notebook_js",{script:"(function(){ window.__SHADOW_CLEAR_ABORT = true; window.__SHADOW_CLEAR_DONE = true; })()"})}catch{}}async injectSendScript(t,e,n){const o=`
      (async function() {
        const SEL = ${JSON.stringify(t)};
        ${this.buildLogHelper(n)}

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
          nativeSetter.call(input, ${JSON.stringify(e)});
        } catch(e) {
          input.value = ${JSON.stringify(e)};
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
    `;await a("execute_notebook_js",{script:o})}async waitForAck(t,e,n,o){const u=o??this.config.timeouts?.ackTimeoutMs??3e4,s=Date.now(),d=500;for(;Date.now()-s<u;){const w=`
        (function() {
          const SEL = ${JSON.stringify(t)};
          const pairs = document.querySelectorAll(SEL.CHAT_PAIR);
          const pairCount = pairs.length;
          const inp = document.querySelector(SEL.INPUT);
          const inputReady = inp && !inp.disabled;
          const inputCleared = inp && inp.value.trim().length === 0;

          // 检查最后一个 pair 的 bot 回复是否已完成（copy 按钮出现）
          let botFinished = false;
          if (pairCount >= ${e}) {
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
      `;try{const l=await a("execute_notebook_js",{script:w});if(l)try{const c=JSON.parse(l);if(c.pairCount>=e&&c.botFinished)return console.log(`[NotebookShadow:${n.slice(-6)}] Ack received: pairs=${c.pairCount}, inputReady=${c.inputReady}`),!0}catch{}}catch(l){console.warn(`[NotebookShadow:${n.slice(-6)}] waitForAck check failed:`,l)}await new Promise(l=>setTimeout(l,d))}return console.warn(`[NotebookShadow:${n.slice(-6)}] waitForAck timeout after ${u}ms`),!1}async*observeAndRelay(t,e){const n=this.config.timeouts?.relayIntervalMs??500,o=this.config.timeouts?.totalTimeoutCycles??240,u=this.config.timeouts?.finishedConfirmMs??3e3,s=this.config.timeouts?.noResponseTimeoutMs??6e4,d=this.config.timeouts?.silenceTimeoutMs??3e4,w=Math.ceil(s/n),l=Math.ceil(d/n),c=`
      (function() {
        const SESSION_ID = "${e}";
        const SEL = ${JSON.stringify(t)};
        ${this.buildLogHelper(e)}

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
        }, ${n});

        log('In-page observer started (global var mode)');
      })();
    `;await a("execute_notebook_js",{script:c}),await new Promise(i=>setTimeout(i,1e3));try{if(await a("execute_notebook_js",{script:"(function(){ return String(!!window.__SHADOW_SEND_FAILED); })()"})==="true"){console.error("[NotebookShadow] Send failed (button not found), aborting observer"),yield{text:"发送失败：未找到发送按钮，请检查 NotebookLM 页面状态",status:"error"};return}}catch{}const S=`
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
    `,D=await m("shadow-log",i=>console.log("[Shadow-Remote]",i.payload));let T=null;const C=await m("shadow-result",i=>{T=i.payload});try{let i="",f=0,_=0,A=null,h=0,y=-1,E=0;for(;_<o;){try{await a("execute_notebook_js",{script:S}),h=0}catch(r){if(h++,console.warn(`[NotebookShadow] Relay injection failed (${h}):`,r),h>10){console.error("[NotebookShadow] Too many relay failures, aborting");break}}if(await new Promise(r=>setTimeout(r,n)),T)try{const r=JSON.parse(T);if(T=null,r.heartbeat!==void 0&&(r.heartbeat===y?E++:(E=0,y=r.heartbeat)),r.heartbeatOnly){_++,_%20===0&&console.log(`[NotebookShadow] Heartbeat: h=${r.heartbeat}, idle=${_}, active=${r.active}, pairs=${r.pairCount||"?"}`),E>30&&(console.warn("[NotebookShadow] Observer heartbeat stale, re-injecting..."),E=0);continue}if(r.error){console.warn("[NotebookShadow] Observer error:",r.error),_++;continue}const{text:p,finished:O}=r;if(p&&p!==i){f++,i=p,_=0,A=null;const g=f>=2&&O;if(yield{text:p,status:g?"complete":"streaming"},g)break}else O&&i&&!A&&f>=2?(A=Date.now(),console.log("[NotebookShadow] Finished signal received, starting confirmation countdown...")):_++}catch{_++}else _++;if(A&&Date.now()-A>=u){console.log("[NotebookShadow] Finished confirmed after delay, completing."),yield{text:i,status:"complete"};break}if(!i&&f===0&&_>w){console.error(`[NotebookShadow] No response in ${s}ms, message likely not sent or input too long`),yield{text:"",status:"error"};break}if(i&&_>l){console.log(`[NotebookShadow] Hard timeout (${d}ms silence), completing with last text.`),yield{text:i,status:"complete"};break}}}finally{await a("execute_notebook_js",{script:"if(window.__SHADOW_POLL_INTERVAL){clearInterval(window.__SHADOW_POLL_INTERVAL);window.__SHADOW_POLL_INTERVAL=null;}"}).catch(()=>{}),C(),D()}}async getChatPairCount(t){const e=`
      (function() {
        const SEL = ${JSON.stringify(t)};
        return document.querySelectorAll(SEL.CHAT_PAIR).length;
      })();
    `;try{const n=await a("execute_notebook_js",{script:e}),o=parseInt(n,10);return isNaN(o)?0:o}catch{return 0}}async*query(t){if(!b())throw new Error("NotebookLM 回复功能仅在桌面客户端可用");const e=`session_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;console.log(`[NotebookShadow] Starting new query session: ${e}`);const n=await this.acquireLock();try{await this.init();const o=await this.loadSelectors();await this.injectClearScript(o,e),await this.injectSendScript(o,t,e),yield{text:"",status:"streaming"},yield*this.observeAndRelay(o,e)}catch(o){yield{text:`影子浏览器异常: ${o instanceof Error?o.message:String(o)}`,status:"error"}}finally{n()}}async*queryMultiRound(t){if(!b())throw new Error("NotebookLM 回复功能仅在桌面客户端可用");if(t.length<=1){yield*this.query(t[0]||"");return}const e=`session_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;console.log(`[NotebookShadow] Starting multi-round session: ${e}, ${t.length} messages`);const n=await this.acquireLock();try{await this.init();const o=await this.loadSelectors();await this.injectClearScript(o,e),yield{text:"",status:"streaming"};for(let s=0;s<t.length-1;s++){console.log(`[NotebookShadow:${e.slice(-6)}] Sending intermediate message ${s+1}/${t.length-1}, length=${t[s].length}`);const d=await this.getChatPairCount(o);await this.injectSendScript(o,t[s],e),await this.waitForAck(o,d+1,e)||console.warn(`[NotebookShadow:${e.slice(-6)}] Intermediate message ${s+1} ack timeout, continuing...`);const l=this.config.timeouts?.interMessageDelayMs??1e3;await new Promise(c=>setTimeout(c,l))}const u=t.length-1;console.log(`[NotebookShadow:${e.slice(-6)}] Sending final message, length=${t[u].length}`),await this.injectSendScript(o,t[u],e),yield*this.observeAndRelay(o,e)}catch(o){yield{text:`影子浏览器异常: ${o instanceof Error?o.message:String(o)}`,status:"error"}}finally{n()}}async show(){b()&&(await this.init(),await a("toggle_notebook_window",{visible:!0}))}async hide(){b()&&await a("toggle_notebook_window",{visible:!1})}}export{N as DEFAULT_SELECTORS,x as NotebookShadowService,k as SELECTORS_APP_CODE};
