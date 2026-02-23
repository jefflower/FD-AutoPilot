import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauriEnv } from '../bridge';
import { userSettingsApi } from '../../shared/services/serverApi';

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
 *
 * v4 扩展 — 多轮分段输入：
 * 当工单内容超长时，通过 queryMultiRound 将内容分段发送给 NotebookLM，
 * 前 N-1 段使用简化等待（sendAndWaitAck），最后一段使用完整 observer+relay。
 */

/** NotebookLM DOM 选择器默认值（与 NotebookLM 页面结构对应） */
const DEFAULT_SELECTORS: Record<string, string> = {
  INPUT: 'textarea.query-box-input',
  CHAT_PAIR: '.chat-message-pair',
  CHAT_PAIR_ALT: '[role="log"] .message-content',
  BOT_REPLY: '.to-user-container .message-text-content',
  BOT_REPLY_FALLBACK_1: '.model-response-text',
  BOT_REPLY_FALLBACK_2: '.response-container',
  COPY_BUTTON: '.xap-copy-to-clipboard',
  SEND_BUTTON: 'button.submit-button:not([disabled])',
  MENU_BUTTON: 'button[aria-label="对话选项"]',
  CONFIRM_DELETE: 'button.yes-button',
};

const SELECTORS_APP_CODE = 'notebook-selectors';

/**
 * 加载 NotebookLM DOM 选择器
 * 优先从 UserAppSettings API 加载自定义配置，失败则使用内置默认值
 */
async function loadSelectors(): Promise<Record<string, string>> {
  try {
    const raw = await userSettingsApi.getSettings(SELECTORS_APP_CODE);
    if (raw) {
      const custom = JSON.parse(raw) as Record<string, string>;
      return { ...DEFAULT_SELECTORS, ...custom };
    }
  } catch {
    console.warn('[NotebookShadow] Failed to load custom selectors, using defaults');
  }
  return { ...DEFAULT_SELECTORS };
}

/** 导出默认选择器供 SettingsTab 使用 */
export { DEFAULT_SELECTORS, SELECTORS_APP_CODE };

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

  // ====== 提取的子方法 ======

  /**
   * 生成日志辅助函数的 JS 代码片段（供注入脚本内部使用）
   */
  private buildLogHelper(sessionId: string): string {
    return `
      const log = (msg) => {
        if (window.__TAURI__?.core) {
          window.__TAURI__.core.invoke('forward_shadow_event', {
            event: 'shadow-log',
            payload: '[Shadow:' + '${sessionId}'.slice(-6) + '] ' + msg
          }).catch(() => {});
        }
      };
    `;
  }

  /**
   * 注入清理历史记录的脚本
   * 清除 NotebookLM 聊天历史，确保干净的会话环境
   */
  private async injectClearScript(selectors: Record<string, string>, sessionId: string): Promise<void> {
    const clearScript = `
      (async function() {
        const SEL = ${JSON.stringify(selectors)};
        ${this.buildLogHelper(sessionId)}

        // 标记清理开始
        window.__SHADOW_CLEAR_DONE = false;

        // 清除上一次的 observer
        if (window.__SHADOW_POLL_INTERVAL) {
          clearInterval(window.__SHADOW_POLL_INTERVAL);
          window.__SHADOW_POLL_INTERVAL = null;
        }

        // 重置所有会话状态
        window.__SHADOW_SESSION_ID = "${sessionId}";
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
    `;
    await invoke('execute_notebook_js', { script: clearScript });

    // 轮询等待清理完成（最多 15 秒），而非硬等 1 秒
    const maxWaitMs = 15000;
    const pollMs = 500;
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      try {
        const result = await invoke('execute_notebook_js', {
          script: '(function(){ return String(!!window.__SHADOW_CLEAR_DONE); })()'
        }) as string;
        if (result === 'true') {
          console.log(`[NotebookShadow:${sessionId.slice(-6)}] Clear completed in ${Date.now() - startTime}ms`);
          return;
        }
      } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, pollMs));
    }
    console.warn(`[NotebookShadow:${sessionId.slice(-6)}] Clear timeout after ${maxWaitMs}ms, proceeding anyway`);
  }

  /**
   * 注入发送消息的脚本
   * 设置输入框文本并点击发送按钮
   * @returns 是否成功发送
   */
  private async injectSendScript(selectors: Record<string, string>, text: string, sessionId: string): Promise<void> {
    const sendScript = `
      (async function() {
        const SEL = ${JSON.stringify(selectors)};
        ${this.buildLogHelper(sessionId)}

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
          nativeSetter.call(input, ${JSON.stringify(text)});
        } catch(e) {
          input.value = ${JSON.stringify(text)};
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
    `;
    await invoke('execute_notebook_js', { script: sendScript });
  }

  /**
   * 等待消息发送确认（chat-pair 数量增加 + 输入框恢复可用）
   * 用于多轮发送的中间消息简化等待
   * @param expectedPairCount 期望的 chat-pair 最少数量（发送前的数量 + 1）
   * @param timeoutMs 超时毫秒数
   */
  private async waitForAck(selectors: Record<string, string>, expectedPairCount: number, sessionId: string, timeoutMs: number = 30000): Promise<boolean> {
    const startTime = Date.now();
    const pollInterval = 500;

    while (Date.now() - startTime < timeoutMs) {
      const checkScript = `
        (function() {
          const SEL = ${JSON.stringify(selectors)};
          const pairs = document.querySelectorAll(SEL.CHAT_PAIR);
          const pairCount = pairs.length;
          const inp = document.querySelector(SEL.INPUT);
          const inputReady = inp && !inp.disabled;
          const inputCleared = inp && inp.value.trim().length === 0;

          // 检查最后一个 pair 的 bot 回复是否已完成（copy 按钮出现）
          let botFinished = false;
          if (pairCount >= ${expectedPairCount}) {
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
      `;

      try {
        const resultStr = await invoke('execute_notebook_js', { script: checkScript }) as string;
        if (resultStr) {
          try {
            const result = JSON.parse(resultStr);
            if (result.pairCount >= expectedPairCount && result.botFinished) {
              console.log(`[NotebookShadow:${sessionId.slice(-6)}] Ack received: pairs=${result.pairCount}, inputReady=${result.inputReady}`);
              return true;
            }
          } catch {
            // JSON 解析失败，继续轮询
          }
        }
      } catch (e) {
        console.warn(`[NotebookShadow:${sessionId.slice(-6)}] waitForAck check failed:`, e);
      }

      await new Promise(r => setTimeout(r, pollInterval));
    }

    console.warn(`[NotebookShadow:${sessionId.slice(-6)}] waitForAck timeout after ${timeoutMs}ms`);
    return false;
  }

  /**
   * 注入 in-page observer 并启动 relay 循环，等待最终回复完成
   * 这是 query 流程的核心——建立 DOM 监控 + 事件中继 + 完成检测
   */
  private async *observeAndRelay(selectors: Record<string, string>, sessionId: string): AsyncIterableIterator<ShadowResponse> {
    // 注入 observer 脚本：建立 setInterval 监控 DOM 变化
    const observerScript = `
      (function() {
        const SESSION_ID = "${sessionId}";
        const SEL = ${JSON.stringify(selectors)};
        ${this.buildLogHelper(sessionId)}

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
    `;

    await invoke('execute_notebook_js', { script: observerScript });

    // 检查发送是否失败（injectSendScript 设置的标记）
    await new Promise(r => setTimeout(r, 1000));
    try {
      const sendCheck = await invoke('execute_notebook_js', {
        script: '(function(){ return String(!!window.__SHADOW_SEND_FAILED); })()'
      }) as string;
      if (sendCheck === 'true') {
        console.error('[NotebookShadow] Send failed (button not found), aborting observer');
        yield { text: '发送失败：未找到发送按钮，请检查 NotebookLM 页面状态', status: 'error' };
        return;
      }
    } catch { /* ignore check failure, proceed */ }

    // relay 脚本
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

    // 监听日志和中继结果
    const unlistenLog = await listen<string>('shadow-log', (e) => console.log('[Shadow-Remote]', e.payload));

    let shadowResult: string | null = null;
    const unlistenResult = await listen<string>('shadow-result', (e) => {
      shadowResult = e.payload;
    });

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
      while (idleCount < 240) { // 约 4 分钟总超时（对齐 Rust 5 分钟 + 30s 宽限期）

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
              if (idleCount % 20 === 0) {
                console.log(`[NotebookShadow] Heartbeat: h=${parsed.heartbeat}, idle=${idleCount}, active=${parsed.active}, pairs=${parsed.pairCount || '?'}`);
              }
              if (heartbeatStaleCount > 30) {
                console.warn('[NotebookShadow] Observer heartbeat stale, re-injecting...');
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

        // 硬超时 A：60 秒完全无任何文本响应（消息可能根本没有发送成功）
        if (!lastYieldedText && textChangeCount === 0 && idleCount > 120) {
           console.error('[NotebookShadow] No response in 60s, message likely not sent or input too long');
           yield { text: '', status: 'error' };
           break;
        }
        // 硬超时 B：30 秒有文本但不再变化（bot 已停止生成）
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
  }

  /**
   * 获取当前 chat-pair 数量
   */
  private async getChatPairCount(selectors: Record<string, string>): Promise<number> {
    const script = `
      (function() {
        const SEL = ${JSON.stringify(selectors)};
        return document.querySelectorAll(SEL.CHAT_PAIR).length;
      })();
    `;
    try {
      const result = await invoke('execute_notebook_js', { script }) as string;
      const count = parseInt(result, 10);
      return isNaN(count) ? 0 : count;
    } catch {
      return 0;
    }
  }

  // ====== 公开方法 ======

  /**
   * 单轮查询（向后兼容的原始接口）
   * forceClear → 输入 prompt → 发送 → observer + relay 等待完成
   */
  async *query(prompt: string): AsyncIterableIterator<ShadowResponse> {
    if (!isTauriEnv()) {
      throw new Error('NotebookLM 回复功能仅在桌面客户端可用');
    }

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[NotebookShadow] Starting new query session: ${sessionId}`);

    const releaseLock = await this.acquireLock();

    try {
      await this.init();

      // 动态加载选择器
      const selectors = await loadSelectors();

      // Step 1: 清理历史 + 重置状态
      await this.injectClearScript(selectors, sessionId);

      // Step 2: 输入文本并点击发送
      await this.injectSendScript(selectors, prompt, sessionId);

      yield { text: "", status: 'streaming' };

      // Step 3: 建立 observer + relay 循环等待完成
      yield* this.observeAndRelay(selectors, sessionId);
    } catch (err: unknown) {
      yield { text: `影子浏览器异常: ${err instanceof Error ? err.message : String(err)}`, status: 'error' };
    } finally {
      releaseLock();
    }
  }

  /**
   * 多轮分段查询
   *
   * 当内容超长需要分段发送时使用。
   * - 前 N-1 条消息使用简化等待（sendAndWaitAck），仅等待 bot 响应完毕
   * - 最后一条消息使用完整 observer + relay 完成检测
   *
   * 单条消息时退化为 query()。
   */
  async *queryMultiRound(messages: string[]): AsyncIterableIterator<ShadowResponse> {
    if (!isTauriEnv()) {
      throw new Error('NotebookLM 回复功能仅在桌面客户端可用');
    }

    // 单条消息退化为原有 query()
    if (messages.length <= 1) {
      yield* this.query(messages[0] || '');
      return;
    }

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[NotebookShadow] Starting multi-round session: ${sessionId}, ${messages.length} messages`);

    const releaseLock = await this.acquireLock();

    try {
      await this.init();

      // 动态加载选择器
      const selectors = await loadSelectors();

      // Step 1: forceClear（只在开头清理一次）
      await this.injectClearScript(selectors, sessionId);

      yield { text: '', status: 'streaming' };

      // Step 2: 发送前 N-1 条（中间消息），每条用简化等待
      for (let i = 0; i < messages.length - 1; i++) {
        console.log(`[NotebookShadow:${sessionId.slice(-6)}] Sending intermediate message ${i + 1}/${messages.length - 1}, length=${messages[i].length}`);

        // 获取发送前的 pair 数量
        const pairCountBefore = await this.getChatPairCount(selectors);

        // 发送消息
        await this.injectSendScript(selectors, messages[i], sessionId);

        // 等待 bot 响应完成（pair 数量增加 + bot 回复完毕）
        const acked = await this.waitForAck(selectors, pairCountBefore + 1, sessionId, 30000);
        if (!acked) {
          console.warn(`[NotebookShadow:${sessionId.slice(-6)}] Intermediate message ${i + 1} ack timeout, continuing...`);
        }

        // 中间消息之间稍作延迟，避免操作过快
        await new Promise(r => setTimeout(r, 1000));
      }

      // Step 3: 发送最后一条，使用完整的 observer + relay 完成检测
      const lastIndex = messages.length - 1;
      console.log(`[NotebookShadow:${sessionId.slice(-6)}] Sending final message, length=${messages[lastIndex].length}`);

      await this.injectSendScript(selectors, messages[lastIndex], sessionId);

      // 使用完整的 observer + relay 循环等待最终回复
      yield* this.observeAndRelay(selectors, sessionId);
    } catch (err: unknown) {
      yield { text: `影子浏览器异常: ${err instanceof Error ? err.message : String(err)}`, status: 'error' };
    } finally {
      releaseLock();
    }
  }

  async show() {
    if (!isTauriEnv()) return;
    await this.init();
    await invoke('toggle_notebook_window', { visible: true });
  }

  async hide() {
    if (!isTauriEnv()) return;
    await invoke('toggle_notebook_window', { visible: false });
  }
}
