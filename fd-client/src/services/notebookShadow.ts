import { invoke } from '@tauri-apps/api/core';

export interface ShadowResponse {
  text: string;
  status: 'streaming' | 'complete' | 'error';
}

/**
 * NotebookLM 影子窗口服务
 * 针对 Google 的严苛环境，采用具备远程域权限放通的 IPC 模式进行通信
 */
export class NotebookShadowService {
  private notebookId: string;

  constructor(notebookId: string) {
    this.notebookId = notebookId;
  }

  /**
   * 初始化影子窗口
   */
  async init() {
    console.log('[Shadow] Initializing window for:', this.notebookId);
    try {
      console.log('[Shadow] Calling open_notebook_window...');
      await invoke('open_notebook_window', { notebookId: this.notebookId });
      // 增加延时确保导航和基础脚本加载
      console.log('[Shadow] Waiting for window to settle (3000ms)...');
      await new Promise(r => setTimeout(r, 3000));
      console.log('[Shadow] open_notebook_window completed successfully');
    } catch (err) {
      console.error('[Shadow] open_notebook_window failed:', err);
      throw err;
    }
  }

  /**
   * 发送提问并监听输出 (基于权限放通的 IPC 模式)
   */
  async *query(prompt: string): AsyncIterableIterator<ShadowResponse> {
    console.log('[Shadow] query() called with prompt length:', prompt.length);
    try {
      console.log('[Shadow] Step 1: Initializing shadow window...');
      await this.init();
      console.log('[Shadow] Step 2: Shadow window initialized');

      // 3. 注入指令 (仅负责输入与发送，不再负责数据回传)
      const injectScript = `
        (async function() {
          console.log('[Shadow JS] ========== SCRIPT INJECTION START ==========');
          
          // 重置运行标志，允许重复执行
          window.__SHADOW_RUNNING__ = false;
          
          // 步骤 1: 先清除历史对话记录
          async function clearHistory() {
            console.log('[Shadow JS] Step 1: Clearing history...');
            const optionsBtn = document.querySelector('button[aria-label="对话选项"], button[aria-label="Conversation options"]');
            if (!optionsBtn) {
              console.log('[Shadow JS] Options button not found, skipping clear');
              return;
            }
            
            optionsBtn.click();
            console.log('[Shadow JS] Options button clicked, waiting for menu...');
            await new Promise(r => setTimeout(r, 800));
            
            const menuItems = Array.from(document.querySelectorAll('.mat-mdc-menu-content button, [role="menuitem"]'));
            console.log('[Shadow JS] Found menu items:', menuItems.length);
            
            const deleteItem = menuItems.find(el => 
              el.textContent.includes('删除对话记录') || 
              el.textContent.includes('Delete conversation') ||
              el.textContent.includes('Delete chat')
            );
            
            if (!deleteItem) {
          console.log('[Shadow JS] Step 2: Starting input process...');
          
          // 步骤 2: 等待页面准备好并输入
          async function doInput() {
            // 等待输入框出现
            let input = null;
            for (let i = 0; i < 40; i++) {
              input = document.querySelector('textarea.query-box-input, textarea[aria-label*="查询框"], textarea[aria-label*="Chat box"], textarea[aria-label*="Ask"]');
              if (input) break;
              await new Promise(r => setTimeout(r, 500));
            }
            
            if (!input) {
              console.error('[Shadow JS] Input not found after waiting!');
              return;
            }
            
            console.log('[Shadow JS] Found input:', input.className);
            input.style.border = '3px solid green';
            const valueToSet = ${JSON.stringify(prompt)};

            // 输入内容
            input.focus();
            input.click();
            await new Promise(r => setTimeout(r, 200));
            input.value = '';
            input.textContent = '';
            await new Promise(r => setTimeout(r, 100));
            
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(input);
            selection.removeAllRanges();
            selection.addRange(range);
            if (!document.execCommand('insertText', false, valueToSet)) {
              input.value = valueToSet;
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(r => setTimeout(r, 50));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.blur();
            input.focus();
            
            console.log('[Shadow JS] Step 3: Content input done, clicking send...');
            await new Promise(r => setTimeout(r, 1200));
            
            // 点击发送按钮
            const sendBtn = document.querySelector('button.submit-button') || 
                            document.querySelector('button[aria-label="提交"]:not(.actions-enter-button)') ||
                            document.querySelector('button[aria-label="Send"]:not(.actions-enter-button)');
            if (sendBtn) {
              sendBtn.disabled = false;
              sendBtn.style.border = '3px solid blue';
              const opts = { bubbles: true, cancelable: true, view: window };
              sendBtn.dispatchEvent(new MouseEvent('mousedown', opts));
              await new Promise(r => setTimeout(r, 200));
              sendBtn.dispatchEvent(new MouseEvent('mouseup', opts));
              sendBtn.click();
              console.log('[Shadow JS] Send button clicked!');
              
              await new Promise(r => setTimeout(r, 500));
              if (input.value && input.value.length > 0) {
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
              }
            }
            
            console.log('[Shadow JS] Step 4: All done!');
          }
          
          await doInput();
        })();
      `;


      console.log('[Shadow] Step 5: Injecting script to shadow window...');
      await invoke('execute_notebook_js', { script: injectScript });
      console.log('[Shadow] Step 6: Script injected successfully');

      // --- 下面是"拉取模式 (Pull Mode)"的核心逻辑 ---
      // Rust 端通过 forward_shadow_event 发送事件，我们在这里监听
      const { listen } = await import('@tauri-apps/api/event');
      
      // 等待删除历史和输入操作完成 (clearHistory + input 大约需要4秒)
      console.log('[Shadow] Step 6.5: Waiting 5s for delete history and input to complete...');
      await new Promise(r => setTimeout(r, 5000));
      
      try {
        let lastReceivedText = "";
        let idleSeconds = 0;
        console.log('[Shadow] Step 7: Starting poll-based retrieval loop (60s timeout)...');

        while (idleSeconds < 60) {
          // 使用事件监听获取结果
          const resultPromise = new Promise<string>((resolve) => {
            const timeout = setTimeout(() => resolve(""), 1500); // 1.5秒超时
            listen<string>('shadow-result', (event) => {
              clearTimeout(timeout);
              console.log('[Shadow] Received event payload:', event.payload?.substring(0, 100));
              resolve(event.payload || "");
            }).then(unlisten => {
              setTimeout(() => unlisten(), 2000);
            });
          });
          
          // 触发 Rust 执行脚本
          await invoke('get_shadow_result');
          const rawResult = await resultPromise;
          
          // 解析 JSON 格式的返回值
          let currentText = "";
          let isFinished = false;
          try {
            if (rawResult && rawResult.startsWith('{')) {
              const parsed = JSON.parse(rawResult);
              currentText = parsed.text || "";
              isFinished = parsed.finished === true;
            }
          } catch (e) {
            console.log('[Shadow] Parse error:', e);
          }
          
          if (currentText && currentText !== lastReceivedText && currentText.length > 10) {
            console.log('[Shadow] New content, length:', currentText.length, 'finished:', isFinished);
            lastReceivedText = currentText;
            idleSeconds = 0;
            yield { text: currentText, status: isFinished ? 'complete' : 'streaming' };
            
            if (isFinished) {
              console.log('[Shadow] AI generation complete, exiting loop');
              break;
            }
          } else {
            idleSeconds++;
          }

          // 如果已有一定长度且5秒未变化，认为生成完成
          if (idleSeconds > 5 && lastReceivedText.length > 50) {
            console.log('[Shadow] Content stable for 5s, ending loop');
            yield { text: lastReceivedText, status: 'complete' };
            break;
          }

          await new Promise(r => setTimeout(r, 1000)); // 每秒拉取一次
        }
        
        console.log('[Shadow] Retrieval loop ended. Final length:', lastReceivedText.length);
      } finally {
        console.log('[Shadow] Query process complete');
      }

    } catch (err) {
      yield { text: `影子浏览器拉取异常: ${err}`, status: 'error' };
    }
  }

  /**
   * 显示影子窗口
   */
  async show() {
    await this.init();
    await invoke('toggle_notebook_window', { visible: true });
  }

  /**
   * 隐藏影子窗口
   */
  async hide() {
    await invoke('toggle_notebook_window', { visible: false });
  }
}
