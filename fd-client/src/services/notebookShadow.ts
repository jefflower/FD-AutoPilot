import { invoke } from '@tauri-apps/api/core';

export interface ShadowResponse {
  text: string;
  status: 'streaming' | 'complete' | 'error';
}

/**
 * NotebookLM 影子窗口服务 - 结构化校验增强版
 * 专门解决“中间思考过程被抓取”的问题
 */
export class NotebookShadowService {
  private notebookId: string;
  private notebookUrl?: string;
  private initialized: boolean = false;

  constructor(notebookId: string, notebookUrl?: string) {
    this.notebookId = notebookId;
    this.notebookUrl = notebookUrl;
  }

  async init() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      await invoke('open_notebook_window', { 
        notebookId: this.notebookId,
        notebookUrl: this.notebookUrl
      });
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      this.initialized = false;
      throw err;
    }
  }

  async *query(prompt: string): AsyncIterableIterator<ShadowResponse> {
    try {
      await this.init();

      const mainScript = `
        (async function() {
          const log = (msg) => {
            if (window.__TAURI__?.core) {
              window.__TAURI__.core.invoke('forward_shadow_event', { 
                event: 'shadow-log', 
                payload: '[Shadow] ' + msg 
              }).catch(() => {});
            }
          };

          window.__SHADOW_SESSION_ACTIVE = false;
          window.__SHADOW_LAST_TEXT = "";

          async function forceClear() {
             for (let i = 0; i < 3; i++) {
                const pairs = document.querySelectorAll('.chat-message-pair, [role="log"] .message-content');
                if (pairs.length === 0) return true;
                
                const menuBtn = document.querySelector('button[aria-label="对话选项"]') || 
                                Array.from(document.querySelectorAll('button')).find(b => b.innerHTML.includes('more_vert') || b.innerText.includes('more_vert'));
                if (!menuBtn) { await new Promise(r => setTimeout(r, 1000)); continue; }
                
                menuBtn.click();
                await new Promise(r => setTimeout(r, 800));
                
                const delItem = Array.from(document.querySelectorAll('.mat-mdc-menu-item, [role="menuitem"]')).find(el => 
                   el.innerText.includes('删除对话记录') || el.innerText.includes('Delete') || el.innerText.includes('清除')
                );
                
                if (delItem) {
                   delItem.click();
                   await new Promise(r => setTimeout(r, 1000));
                   const confirm = document.querySelector('button.yes-button') || 
                                   Array.from(document.querySelectorAll('button')).find(el => 
                                     (el.innerText.includes('删除') || el.innerText.includes('Delete')) && el.classList.contains('mat-mdc-button-base')
                                   );
                   if (confirm) {
                      confirm.click();
                      await new Promise(r => setTimeout(r, 2500));
                      if (document.querySelectorAll('.chat-message-pair').length === 0) return true;
                   }
                } else {
                   document.body.click();
                }
                await new Promise(r => setTimeout(r, 1000));
             }
             return false;
          }

          log('Process: Pure Cleaning...');
          await forceClear();
          
          const input = document.querySelector('textarea.query-box-input');
          if (!input) { log('❌ FATAL: No input element'); return; }
          
          input.value = ${JSON.stringify(prompt)};
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 500));

          const sendBtn = document.querySelector('button.submit-button') || 
                          Array.from(document.querySelectorAll('button')).find(b => b.innerHTML.includes('arrow_forward') && !b.disabled);
          
          if (sendBtn) {
            sendBtn.click();
            window.__SHADOW_SESSION_ACTIVE = true;
            log('✅ NEW SESSION STARTED');
          }
        })();
      `;

      await invoke('execute_notebook_js', { script: mainScript });
      
      const { listen } = await import('@tauri-apps/api/event');
      yield { text: "", status: 'streaming' };

      let shadowResult: string | null = null;
      const unlistenResult = await listen<string>('shadow-result', (e) => {
        shadowResult = e.payload;
      });
      const unlistenLog = await listen<string>('shadow-log', (e) => console.log('[Shadow-Remote]', e.payload));

      try {
        let lastYieldedText = "";
        let idleCount = 0;
        let everValid = false;

        while (idleCount < 360) { // 3分钟总超时 (360 * 500ms)
          const pollScript = `
            (function() {
              if (!window.__SHADOW_SESSION_ACTIVE) return;
              try {
                // 1. 获取最后一个回复消息容器 (聚合同一条消息内的所有块)
                const pairs = document.querySelectorAll('.chat-message-pair');
                if (pairs.length === 0) return;
                
                const lastPair = pairs[pairs.length - 1];
                // 提取容器内所有的文本内容，处理换行导致的多个 div/span
                const text = (lastPair.innerText || lastPair.textContent || "").trim();
                
                // 2. 括号平衡校验逻辑
                function isJsonBalanced(str) {
                  let open = 0, close = 0;
                  for (let char of str) {
                    if (char === '[') open++;
                    if (char === ']') close++;
                  }
                  return open > 0 && open === close;
                }

                // 3. 动态状态分析
                const balanced = isJsonBalanced(text);
                const input = document.querySelector('textarea.query-box-input');
                const botIdle = input && !input.disabled;
                
                // 判定完成状态：
                // (JSON配对成功 且 机器人空闲) -> 正常收工
                const isFinished = balanced && botIdle;
                
                const payload = JSON.stringify({ 
                  text, 
                  finished: isFinished, 
                  valid: balanced 
                });

                if (text !== window.__SHADOW_LAST_TEXT) {
                   window.__SHADOW_LAST_TEXT = text;
                   window.__TAURI__.core.invoke('forward_shadow_event', { event: 'shadow-result', payload }).catch(()=>{});
                }
              } catch(e) {}
            })()
          `;

          await invoke('execute_notebook_js', { script: pollScript });
          
          if (shadowResult) {
            try {
              const { text, finished, valid } = JSON.parse(shadowResult);
              shadowResult = null; 

              if (text && text !== lastYieldedText) {
                lastYieldedText = text;
                idleCount = 0;
                everValid = valid;
                yield { text, status: finished ? 'complete' : 'streaming' };
                if (finished) break;
              }
            } catch {}
          } else {
            idleCount++;
          }
          
          // 如果机器人空闲时间过长（5秒）且已有内容，强制结束，防止因微小字符差异导致的死锁
          if (everValid && idleCount > 10) { 
             yield { text: lastYieldedText, status: 'complete' };
             break;
          }
          
          await new Promise(r => setTimeout(r, 500));
        }
      } finally {
        unlistenResult();
        unlistenLog();
      }
    } catch (err: unknown) {
      yield { text: `影子浏览器异常: ${err instanceof Error ? err.message : String(err)}`, status: 'error' };
    }
  }

  async show() {
    await this.init();
    await invoke('toggle_notebook_window', { visible: true });
  }

  async hide() {
    await invoke('toggle_notebook_window', { visible: false });
  }
}
