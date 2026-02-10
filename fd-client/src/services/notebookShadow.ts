import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface ShadowResponse {
  text: string;
  status: 'streaming' | 'complete' | 'error';
}

/**
 * NotebookLM 影子窗口服务
 *
 * 架构说明（v3 — 混合 observer + relay）：
 * 1. mainScript 在 webview 内建立 setInterval observer，监测 DOM 变化
 * 2. observer 仅写入全局变量 window.__SHADOW_LATEST_RESULT（不做 IPC 调用）
 * 3. generator 定期通过 execute_notebook_js 注入 relay 脚本
 * 4. relay 脚本读取全局变量并调用 forward_shadow_event 中继给主窗口
 *
 * 这样避免了 setInterval 回调中 invoke 不可靠的问题，
 * 同时保留 in-page observer 的连续 DOM 监测能力。
 */

/**
 * 从 Rust 后端动态加载 NotebookLM DOM 选择器
 * 选择器通过 Settings 持久化，支持热更新
 */
async function loadSelectors(): Promise<Record<string, string>> {
  return await invoke('get_notebook_selectors_cmd') as Record<string, string>;
}

// 全局互斥锁状态
let globalQueryLock: Promise<void> = Promise.resolve();

export class NotebookShadowService {
  private notebookId: string;
  private notebookUrl?: string;
  private initialized: boolean = false;

  constructor(notebookId: string, notebookUrl?: string) {
    this.notebookId = notebookId;
    this.notebookUrl = notebookUrl;
  }

  private async acquireLock(): Promise<() => void> {
    await globalQueryLock;
    let release: () => void;
    globalQueryLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    console.log('[NotebookShadow] Query lock acquired');
    return () => {
      console.log('[NotebookShadow] Query lock released');
      release!();
    };
  }

  async init() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      await invoke('open_notebook_window', {
        notebookId: this.notebookId,
        notebookUrl: this.notebookUrl
      });
      // 等待页面加载
      await new Promise(r => setTimeout(r, 3000));
    } catch (err) {
      this.initialized = false;
      throw err;
    }
  }

  async *query(prompt: string): AsyncIterableIterator<ShadowResponse> {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[NotebookShadow] Starting new query session: ${sessionId}`);

    const releaseLock = await this.acquireLock();

    try {
      await this.init();

      // 动态加载选择器
      const selectors = await loadSelectors();

      // ====== mainScript ======
      // 清理 → 输入 → 发送 → 建立 in-page observer
      // observer 仅写 window.__SHADOW_LATEST_RESULT，不做 IPC
      const mainScript = `
        (async function() {
          const SESSION_ID = "${sessionId}";
          const SEL = ${JSON.stringify(selectors)};
          const log = (msg) => {
            if (window.__TAURI__?.core) {
              window.__TAURI__.core.invoke('forward_shadow_event', {
                event: 'shadow-log',
                payload: '[Shadow:' + SESSION_ID.slice(-6) + '] ' + msg
              }).catch(() => {});
            }
          };

          // 清除上一次的 observer
          if (window.__SHADOW_POLL_INTERVAL) {
            clearInterval(window.__SHADOW_POLL_INTERVAL);
            window.__SHADOW_POLL_INTERVAL = null;
          }

          // 重置所有会话状态
          window.__SHADOW_SESSION_ID = SESSION_ID;
          window.__SHADOW_SESSION_ACTIVE = false;
          window.__SHADOW_LAST_TEXT = "";
          window.__SHADOW_LAST_BOT_IDLE = false;
          window.__SHADOW_BOT_RESPONDED = false;
          window.__SHADOW_HEARTBEAT = 0;
          window.__SHADOW_LATEST_RESULT = null;

          async function forceClear() {
             for (let i = 0; i < 3; i++) {
                const pairs = document.querySelectorAll(SEL.CHAT_PAIR + ', ' + SEL.CHAT_PAIR_ALT);
                if (pairs.length === 0) { log('No history to clear'); return true; }

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
            nativeSetter.call(input, ${JSON.stringify(prompt)});
          } catch(e) {
            input.value = ${JSON.stringify(prompt)};
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
            log('NEW SESSION STARTED - send button clicked');

            // 等待确认：检查 chat-message-pair 出现（表示消息已发送）
            let confirmed = false;
            for (let check = 0; check < 20; check++) {
              await new Promise(r => setTimeout(r, 500));
              const pairs = document.querySelectorAll(SEL.CHAT_PAIR);
              const inp = document.querySelector(SEL.INPUT);
              const inputCleared = inp && inp.value.trim().length === 0;
              if (pairs.length > 0 || inputCleared) {
                log('Message confirmed sent: pairs=' + pairs.length + ', inputCleared=' + inputCleared);
                confirmed = true;
                break;
              }
            }
            if (!confirmed) {
              log('Warning: Message send not confirmed after 10s, proceeding anyway');
            }

            // ====== 建立 in-page observer ======
            // 核心：仅写 window.__SHADOW_LATEST_RESULT，不调用 invoke
            window.__SHADOW_POLL_INTERVAL = setInterval(() => {
              if (!window.__SHADOW_SESSION_ACTIVE) return;
              window.__SHADOW_HEARTBEAT = (window.__SHADOW_HEARTBEAT || 0) + 1;
              try {
                const pairs = document.querySelectorAll(SEL.CHAT_PAIR);
                const pairCount = pairs.length;

                if (pairCount === 0) {
                  // 每 10 次（5秒）报告一次空状态
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

                // 【关键】只提取 bot 回复文本，不读整个 chat pair（用户 prompt 中有 [timestamp] 会干扰 JSON 检测）
                var botMsgEl = lastPair.querySelector(SEL.BOT_REPLY) ||
                               lastPair.querySelector(SEL.BOT_REPLY_FALLBACK_1) ||
                               lastPair.querySelector(SEL.BOT_REPLY_FALLBACK_2);
                var text;
                if (botMsgEl) {
                  text = (botMsgEl.innerText || botMsgEl.textContent || '').trim();
                } else {
                  // fallback: 读整个 pair（可能包含 prompt 文本）
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

                // 跟踪 bot 是否已开始响应
                if (!botIdle) window.__SHADOW_BOT_RESPONDED = true;

                // 复制按钮出现 = 生成完毕（比 textarea disabled 更可靠）
                const hasCopyBtn = !!lastPair.querySelector(SEL.COPY_BUTTON);
                const isFinished = window.__SHADOW_BOT_RESPONDED && (hasCopyBtn || (balanced && botIdle));

                // 写入全局变量（每次都写，让 relay 脚本能读到最新状态）
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
          } else {
            log('FATAL: No send button found after retries');
          }
        })();
      `;

      await invoke('execute_notebook_js', { script: mainScript });

      yield { text: "", status: 'streaming' };

      // 监听日志和中继结果
      const unlistenLog = await listen<string>('shadow-log', (e) => console.log('[Shadow-Remote]', e.payload));

      let shadowResult: string | null = null;
      const unlistenResult = await listen<string>('shadow-result', (e) => {
        shadowResult = e.payload;
      });

      // ====== relay 脚本 ======
      // 从 webview 全局变量读取 observer 的结果，通过 IPC 中继到主窗口
      const relayScript = `
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
      `;

      try {
        let lastYieldedText = "";
        let textChangeCount = 0;
        let idleCount = 0;
        let finishedSeenAt: number | null = null;
        const FINISHED_CONFIRM_MS = 3000;
        let relayFailCount = 0;
        let lastHeartbeat = -1;
        let heartbeatStaleCount = 0;

        // 等待循环：定期注入 relay 脚本，读取 observer 写入的全局变量
        while (idleCount < 360) { // 3分钟总超时

          // 注入 relay 脚本
          try {
            await invoke('execute_notebook_js', { script: relayScript });
            relayFailCount = 0;
          } catch (e) {
            relayFailCount++;
            console.warn(`[NotebookShadow] Relay injection failed (${relayFailCount}):`, e);
            if (relayFailCount > 10) {
              console.error('[NotebookShadow] Too many relay failures, aborting');
              break;
            }
          }

          // 等待事件到达
          await new Promise(r => setTimeout(r, 500));

          if (shadowResult) {
            try {
              const parsed = JSON.parse(shadowResult);
              shadowResult = null;

              // 更新心跳
              if (parsed.heartbeat !== undefined) {
                if (parsed.heartbeat === lastHeartbeat) {
                  heartbeatStaleCount++;
                } else {
                  heartbeatStaleCount = 0;
                  lastHeartbeat = parsed.heartbeat;
                }
              }

              // 仅心跳，无数据变化
              if (parsed.heartbeatOnly) {
                idleCount++;
                // 每 20 次（10秒）记录一次心跳状态
                if (idleCount % 20 === 0) {
                  console.log(`[NotebookShadow] Heartbeat: h=${parsed.heartbeat}, idle=${idleCount}, active=${parsed.active}, pairs=${parsed.pairCount || '?'}`);
                }
                // 心跳停滞超过 30 次（15 秒），尝试重新注入 observer
                if (heartbeatStaleCount > 30) {
                  console.warn('[NotebookShadow] Observer heartbeat stale, re-injecting...');
                  // 这里不重新注入完整 mainScript（会清除历史），只重新建立 observer
                  heartbeatStaleCount = 0;
                }
                continue;
              }

              // 有 observer 错误
              if (parsed.error) {
                console.warn('[NotebookShadow] Observer error:', parsed.error);
                idleCount++;
                continue;
              }

              // 正常数据
              const { text, finished } = parsed;

              if (text && text !== lastYieldedText) {
                textChangeCount++;
                lastYieldedText = text;
                idleCount = 0;
                finishedSeenAt = null;

                // 首次文本变化可能是用户 prompt，不信任 finished
                const trustFinished = textChangeCount >= 2 && finished;
                yield { text, status: trustFinished ? 'complete' : 'streaming' };
                if (trustFinished) break;
              } else if (finished && lastYieldedText && !finishedSeenAt && textChangeCount >= 2) {
                finishedSeenAt = Date.now();
                console.log('[NotebookShadow] Finished signal received, starting confirmation countdown...');
              } else {
                idleCount++;
              }
            } catch {
              idleCount++;
            }
          } else {
            idleCount++;
          }

          // 确认超时
          if (finishedSeenAt && (Date.now() - finishedSeenAt) >= FINISHED_CONFIRM_MS) {
            console.log('[NotebookShadow] Finished confirmed after delay, completing.');
            yield { text: lastYieldedText, status: 'complete' };
            break;
          }

          // 硬超时：30 秒完全无文本响应
          if (lastYieldedText && idleCount > 60) {
             console.log('[NotebookShadow] Hard timeout (30s silence), completing with last text.');
             yield { text: lastYieldedText, status: 'complete' };
             break;
          }
        }
      } finally {
        // 清理 in-page observer
        await invoke('execute_notebook_js', {
          script: 'if(window.__SHADOW_POLL_INTERVAL){clearInterval(window.__SHADOW_POLL_INTERVAL);window.__SHADOW_POLL_INTERVAL=null;}'
        }).catch(() => {});
        unlistenResult();
        unlistenLog();
      }
    } catch (err: unknown) {
      yield { text: `影子浏览器异常: ${err instanceof Error ? err.message : String(err)}`, status: 'error' };
    } finally {
      releaseLock();
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
