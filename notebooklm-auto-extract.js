/**
 * NotebookLM 配置自动提取工具
 * 
 * 使用方法:
 * 1. 打开 NotebookLM 页面并登录
 * 2. 按 F12 打开开发者工具,切换到 Console 标签
 * 3. 复制并粘贴整个脚本到 Console
 * 4. 按 Enter 运行
 * 5. 在 NotebookLM 中发送一条消息(任意内容)
 * 6. 脚本会自动捕获并显示所有配置信息
 */

(function () {
    console.log('%c🚀 NotebookLM 配置自动提取工具已启动', 'color: #667eea; font-size: 16px; font-weight: bold;');
    console.log('%c请在 NotebookLM 中发送一条消息...', 'color: #48bb78; font-size: 14px;');

    const extractedConfig = {
        cookie: document.cookie,
        atToken: null,
        fSid: null,
        notebookId: null,
        apiUrl: null
    };

    // 从URL中提取Notebook ID
    const urlMatch = window.location.pathname.match(/\/notebook\/([a-f0-9-]+)/);
    if (urlMatch) {
        extractedConfig.notebookId = urlMatch[1];
    }

    // 拦截 XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    const originalXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
        if (!this._headers) this._headers = {};
        this._headers[header] = value;
        return originalXHRSetRequestHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.open = function (method, url) {
        this._method = method;
        this._url = url;
        return originalXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (data) {
        const url = this._url;
        const method = this._method;

        // 检查是否是目标API请求
        if (method === 'POST' && url && (
            url.includes('GenerateFreeFormStreamed') ||
            url.includes('orchestration') ||
            url.includes('stream') ||
            url.includes('generate')
        )) {
            console.log('%c✅ 捕获到API请求!', 'color: #48bb78; font-size: 14px; font-weight: bold;');

            extractedConfig.apiUrl = url;

            // 提取 f.sid
            try {
                const urlObj = new URL(url, window.location.origin);
                const fSid = urlObj.searchParams.get('f.sid');
                if (fSid) {
                    extractedConfig.fSid = fSid;
                }
            } catch (e) {
                console.warn('提取 f.sid 失败:', e);
            }

            // 提取 at token (从请求体中)
            if (data) {
                try {
                    // 尝试解析 URLSearchParams
                    const params = new URLSearchParams(data);
                    const atToken = params.get('at');
                    if (atToken) {
                        extractedConfig.atToken = atToken;
                    }
                } catch (e) {
                    console.warn('提取 at token 失败:', e);
                }
            }

            // 延迟显示结果,确保所有信息都已提取
            setTimeout(() => {
                displayExtractedConfig();
            }, 500);
        }

        return originalXHRSend.apply(this, arguments);
    };

    // 拦截 Fetch
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const [resource, config] = args;
        const url = typeof resource === 'string' ? resource : resource.url;
        const method = config?.method || 'GET';

        if (method === 'POST' && url && (
            url.includes('GenerateFreeFormStreamed') ||
            url.includes('orchestration') ||
            url.includes('stream') ||
            url.includes('generate')
        )) {
            console.log('%c✅ 捕获到API请求 (Fetch)!', 'color: #48bb78; font-size: 14px; font-weight: bold;');

            extractedConfig.apiUrl = url;

            // 提取 f.sid
            try {
                const urlObj = new URL(url, window.location.origin);
                const fSid = urlObj.searchParams.get('f.sid');
                if (fSid) {
                    extractedConfig.fSid = fSid;
                }
            } catch (e) {
                console.warn('提取 f.sid 失败:', e);
            }

            // 提取 at token
            if (config?.body) {
                try {
                    const params = new URLSearchParams(config.body);
                    const atToken = params.get('at');
                    if (atToken) {
                        extractedConfig.atToken = atToken;
                    }
                } catch (e) {
                    console.warn('提取 at token 失败:', e);
                }
            }

            setTimeout(() => {
                displayExtractedConfig();
            }, 500);
        }

        return originalFetch.apply(this, args);
    };

    // 显示提取的配置
    function displayExtractedConfig() {
        console.clear();
        console.log('%c═══════════════════════════════════════════════════════════', 'color: #667eea; font-weight: bold;');
        console.log('%c🎉 配置信息提取完成!', 'color: #48bb78; font-size: 18px; font-weight: bold;');
        console.log('%c═══════════════════════════════════════════════════════════', 'color: #667eea; font-weight: bold;');
        console.log('');

        // 验证完整性
        const isComplete = extractedConfig.cookie &&
            extractedConfig.atToken &&
            extractedConfig.fSid &&
            extractedConfig.notebookId;

        if (!isComplete) {
            console.log('%c⚠️ 警告: 某些配置信息未能提取', 'color: #f56565; font-size: 14px; font-weight: bold;');
            if (!extractedConfig.atToken) console.log('%c  ❌ at Token 未提取', 'color: #f56565;');
            if (!extractedConfig.fSid) console.log('%c  ❌ f.sid 未提取', 'color: #f56565;');
            if (!extractedConfig.cookie) console.log('%c  ❌ Cookie 未提取', 'color: #f56565;');
            if (!extractedConfig.notebookId) console.log('%c  ❌ Notebook ID 未提取', 'color: #f56565;');
            console.log('');
            console.log('%c💡 提示: 请在 NotebookLM 中发送一条消息', 'color: #ed8936;');
            console.log('');
            return;
        }

        console.log('%c✅ 所有配置信息已成功提取!', 'color: #48bb78; font-weight: bold;');
        console.log('');

        // 显示配置
        console.log('%c📋 配置信息:', 'color: #4299e1; font-size: 14px; font-weight: bold;');
        console.log('');

        console.log('%cNotebook ID:', 'color: #805ad5; font-weight: bold;');
        console.log(extractedConfig.notebookId);
        console.log('');

        console.log('%cF.SID:', 'color: #805ad5; font-weight: bold;');
        console.log(extractedConfig.fSid);
        console.log('');

        console.log('%cAT Token:', 'color: #805ad5; font-weight: bold;');
        console.log(extractedConfig.atToken);
        console.log('');

        console.log('%cCookie:', 'color: #805ad5; font-weight: bold;');
        console.log(extractedConfig.cookie);
        console.log('');

        console.log('%cAPI URL:', 'color: #805ad5; font-weight: bold;');
        console.log(extractedConfig.apiUrl);
        console.log('');

        // 创建JSON对象
        const configJson = {
            notebookId: extractedConfig.notebookId,
            fSid: extractedConfig.fSid,
            atToken: extractedConfig.atToken,
            cookie: extractedConfig.cookie
        };

        console.log('%c═══════════════════════════════════════════════════════════', 'color: #667eea; font-weight: bold;');
        console.log('%c📦 复制下面的JSON配置(已保存到剪贴板):', 'color: #4299e1; font-size: 14px; font-weight: bold;');
        console.log('%c═══════════════════════════════════════════════════════════', 'color: #667eea; font-weight: bold;');
        console.log('');
        console.log(JSON.stringify(configJson, null, 2));
        console.log('');

        // 复制到剪贴板
        const jsonString = JSON.stringify(configJson, null, 2);
        navigator.clipboard.writeText(jsonString).then(() => {
            console.log('%c✅ 配置已复制到剪贴板!', 'color: #48bb78; font-size: 14px; font-weight: bold;');
            console.log('');
            console.log('%c💡 使用方法:', 'color: #4299e1; font-weight: bold;');
            console.log('%c  1. 配置已自动复制到剪贴板', 'color: #718096;');
            console.log('%c  2. 粘贴到测试工具的表单中', 'color: #718096;');
            console.log('%c  3. 或者在代码中直接使用这个JSON', 'color: #718096;');
            console.log('');
        }).catch(err => {
            console.warn('%c⚠️ 自动复制失败,请手动复制上面的JSON', 'color: #ed8936;', err);
        });

        // 保存到全局变量,方便访问
        window.NOTEBOOKLM_CONFIG = configJson;
        console.log('%c💾 配置已保存到: window.NOTEBOOKLM_CONFIG', 'color: #805ad5;');
        console.log('');
        console.log('%c═══════════════════════════════════════════════════════════', 'color: #667eea; font-weight: bold;');
    }

    console.log('%c✅ 拦截器已设置成功', 'color: #48bb78;');
    console.log('%c⏳ 等待捕获API请求...', 'color: #4299e1;');
    console.log('');
    console.log('%c💡 下一步: 在 NotebookLM 的聊天框中发送任意消息', 'color: #ed8936; font-size: 14px;');
    console.log('');
})();
