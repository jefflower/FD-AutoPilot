import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// ==================== 接口定义 ====================

export interface TrackingEvent {
  time: string;
  description: string;
  location: string;
}

export interface TrackingResult {
  trackingNumber: string;
  carrier: string;
  status: string;       // e.g., "InTransit", "Delivered", "PickedUp", "NotFound", "Loading", "Error"
  statusDetail: string; // 详细状态描述
  lastEvent: string;    // 最近一条物流事件
  lastUpdateTime: string;
  events: TrackingEvent[];
}

// ==================== 配置类型 ====================

export interface TrackingExtractionConfig {
  maxNumbers?: number;          // 默认 3
  waitForResultMs?: number;     // 默认 10000（单次提取超时）
  captchaKeywords?: string[];   // 默认 ['captcha', '验证码', 'robot', 'blocked']
}

export interface TrackingConfig {
  windowLabel?: string;           // 默认 'shadow_17track'
  targetUrl?: string;             // 默认 "https://t.17track.net/en#nums=${TRACKING_NUMBERS}"
  selectors?: Record<string, string>;
  extractionConfig?: TrackingExtractionConfig;
  timings?: {
    initialWaitMs?: number;       // 默认 5000
    pollIntervalMs?: number;      // 默认 1500
    maxPollAttempts?: number;     // 默认 20
    extractTimeoutMs?: number;    // 默认 3000
    batchDelayMs?: number;        // 默认 2000
  };
}

// ==================== 内部常量 ====================

const LOG_PREFIX = '[TrackingShadow]';

/** 默认 captcha 检测关键词 */
const DEFAULT_CAPTCHA_KEYWORDS = ['captcha', '验证码', 'robot', 'blocked'];

/** 17track 事件名称，用于影子窗口 → 主窗口中继 */
const TRACKING_RESULT_EVENT = '17track-result';

/** 默认的无结果返回 */
function makeEmptyResult(trackingNumber: string, status = 'NotFound', statusDetail = '未能获取物流信息'): TrackingResult {
  return {
    trackingNumber,
    carrier: 'Unknown',
    status,
    statusDetail,
    lastEvent: '',
    lastUpdateTime: '',
    events: [],
  };
}

// ==================== 采集脚本构造 ====================

/**
 * 构建注入到影子窗口内部的物流信息采集脚本。
 *
 * 采集策略（按优先级）：
 *   1. 尝试从 17track 页面已知 DOM 结构中提取（CSS 选择器）
 *   2. 模糊匹配 class 含 "track" 的容器
 *   3. 从页面全文正则提取关键状态关键词
 *
 * 脚本执行后通过 forward_shadow_event 中继 JSON 结果给主窗口。
 */
function buildExtractScript(trackingNumber: string, captchaKeywords?: string[]): string {
  // 注意：此脚本将被注入到 webview 中执行，不能引用外部 TypeScript 变量。
  // 所有变量均以 IIFE 形式隔离。
  const keywords = captchaKeywords || DEFAULT_CAPTCHA_KEYWORDS;
  return `
(function() {
  try {
    var trackingNumber = ${JSON.stringify(trackingNumber)};
    var captchaKeywords = ${JSON.stringify(keywords)};

    // ---------- 辅助函数 ----------

    function trim(s) { return (s || '').replace(/\\s+/g, ' ').trim(); }

    function sendResult(result) {
      var payload = JSON.stringify(result);
      if (window.__TAURI__ && window.__TAURI__.core) {
        window.__TAURI__.core.invoke('forward_shadow_event', {
          event: '${TRACKING_RESULT_EVENT}',
          payload: payload
        }).catch(function() {});
      } else if (window.__TAURI_INTERNALS__) {
        window.__TAURI_INTERNALS__.invoke('forward_shadow_event', {
          event: '${TRACKING_RESULT_EVENT}',
          payload: payload
        }).catch(function() {});
      }
    }

    // ---------- 检测页面状态 ----------

    // 是否还在加载中：检测常见的 loading / spinner 元素
    var loadingIndicators = document.querySelectorAll(
      '.loading, .spinner, [class*="loading"], [class*="spinner"], .yq-loading'
    );
    var bodyText = (document.body.innerText || '').toLowerCase();

    // 如果页面核心区域几乎没有内容，认为还在加载
    var mainContent = document.querySelector('.main-content, #main, [class*="result"], [class*="track"]');
    if (!mainContent && bodyText.length < 200) {
      sendResult({
        trackingNumber: trackingNumber,
        carrier: 'Unknown',
        status: 'Loading',
        statusDetail: '页面仍在加载中',
        lastEvent: '',
        lastUpdateTime: '',
        events: []
      });
      return;
    }

    // 检测验证码 / 反爬拦截（关键词来自配置）
    var hasCaptchaKeyword = captchaKeywords.some(function(kw) { return bodyText.indexOf(kw.toLowerCase()) !== -1; });
    if (hasCaptchaKeyword ||
        document.querySelector('[class*="captcha"], [id*="captcha"], .g-recaptcha')) {
      sendResult({
        trackingNumber: trackingNumber,
        carrier: 'Unknown',
        status: 'Error',
        statusDetail: '遇到验证码或反爬拦截，请手动处理后重试',
        lastEvent: '',
        lastUpdateTime: '',
        events: []
      });
      return;
    }

    // 检测运单号不存在
    var notFoundPatterns = [
      'not found', '未找到', 'no result', '无结果',
      'no tracking info', '暂无物流信息', 'not yet been picked up',
      '没有追踪信息', 'item not found'
    ];
    var isNotFound = notFoundPatterns.some(function(p) { return bodyText.indexOf(p) !== -1; });

    // ---------- 策略 1: 从 17track 已知 DOM 结构提取 ----------

    var result = {
      trackingNumber: trackingNumber,
      carrier: 'Unknown',
      status: 'Unknown',
      statusDetail: '',
      lastEvent: '',
      lastUpdateTime: '',
      events: []
    };

    // 17track 常见选择器（可能随版本变化）
    var carrierSelectors = [
      '.carrier-name', '.carrier', '[class*="carrier"]',
      '.yq-carrier-name', '.track-carrier', '.logistics-company',
      '.shipment-carrier'
    ];
    var statusSelectors = [
      '.tracking-status', '.status', '[class*="status"]:not(head *)',
      '.yq-status', '.track-status', '.shipment-status',
      '.latest-status', '[class*="latest"]'
    ];
    var eventContainerSelectors = [
      '.tracking-detail', '.event-list', '.track-events',
      '.yq-track-detail', '[class*="event-list"]', '[class*="tracking-detail"]',
      '.shipment-events', '.logistics-detail', '.track-list',
      'table.track-table tbody', '[class*="timeline"]'
    ];
    var eventItemSelectors = [
      '.event-item', '.track-event', '.event-row',
      '.yq-track-item', '[class*="event-item"]', '[class*="track-item"]',
      'tr', 'li', '[class*="timeline-item"]'
    ];

    function queryFirst(selectors) {
      for (var i = 0; i < selectors.length; i++) {
        try {
          var el = document.querySelector(selectors[i]);
          if (el && trim(el.innerText)) return el;
        } catch(e) {}
      }
      return null;
    }

    function queryAll(parentEl, selectors) {
      for (var i = 0; i < selectors.length; i++) {
        try {
          var els = parentEl.querySelectorAll(selectors[i]);
          if (els.length > 0) return Array.from(els);
        } catch(e) {}
      }
      return [];
    }

    // 提取承运商
    var carrierEl = queryFirst(carrierSelectors);
    if (carrierEl) {
      result.carrier = trim(carrierEl.innerText);
    }

    // 提取状态
    var statusEl = queryFirst(statusSelectors);
    if (statusEl) {
      var rawStatus = trim(statusEl.innerText);
      result.statusDetail = rawStatus;
      // 映射常见状态
      var statusLower = rawStatus.toLowerCase();
      if (statusLower.indexOf('deliver') !== -1 || statusLower.indexOf('已签收') !== -1 || statusLower.indexOf('已送达') !== -1) {
        result.status = 'Delivered';
      } else if (statusLower.indexOf('transit') !== -1 || statusLower.indexOf('运输中') !== -1 || statusLower.indexOf('在途') !== -1) {
        result.status = 'InTransit';
      } else if (statusLower.indexOf('pick') !== -1 || statusLower.indexOf('已揽收') !== -1 || statusLower.indexOf('已取件') !== -1) {
        result.status = 'PickedUp';
      } else if (statusLower.indexOf('expired') !== -1 || statusLower.indexOf('过期') !== -1) {
        result.status = 'Expired';
      } else if (statusLower.indexOf('exception') !== -1 || statusLower.indexOf('异常') !== -1) {
        result.status = 'Exception';
      } else if (statusLower.indexOf('return') !== -1 || statusLower.indexOf('退回') !== -1) {
        result.status = 'Returned';
      } else {
        result.status = rawStatus || 'Unknown';
      }
    }

    // 提取事件列表
    var eventContainer = queryFirst(eventContainerSelectors);
    if (eventContainer) {
      var eventItems = queryAll(eventContainer, eventItemSelectors);
      eventItems.forEach(function(item) {
        var timeEl = item.querySelector('[class*="time"], [class*="date"], .event-time, .track-time, td:first-child, time');
        var descEl = item.querySelector('[class*="desc"], [class*="detail"], .event-desc, .track-desc, td:nth-child(2), [class*="content"]');
        var locEl  = item.querySelector('[class*="location"], [class*="loc"], .event-location, .track-location, td:nth-child(3), [class*="place"]');

        var time = timeEl ? trim(timeEl.innerText) : '';
        var desc = descEl ? trim(descEl.innerText) : trim(item.innerText);
        var loc  = locEl  ? trim(locEl.innerText)  : '';

        // 过滤纯空白或过短的条目
        if (desc && desc.length > 2) {
          result.events.push({ time: time, description: desc, location: loc });
        }
      });
    }

    // ---------- 策略 2: 模糊匹配 ----------

    if (result.events.length === 0 && result.status === 'Unknown') {
      var trackContainers = document.querySelectorAll('[class*="track"], [class*="result"], [class*="shipment"]');
      for (var ci = 0; ci < trackContainers.length && result.events.length === 0; ci++) {
        var container = trackContainers[ci];
        var children = container.querySelectorAll('div, li, tr');
        for (var j = 0; j < children.length; j++) {
          var child = children[j];
          var text = trim(child.innerText);
          // 包含日期模式的可能是事件项
          var dateMatch = text.match(/(\\d{4}[-/]\\d{2}[-/]\\d{2}[\\sT]?\\d{0,2}:?\\d{0,2})/);
          if (dateMatch && text.length > 15 && text.length < 500) {
            result.events.push({
              time: dateMatch[1],
              description: text.replace(dateMatch[1], '').trim(),
              location: ''
            });
          }
        }
      }
    }

    // ---------- 策略 3: 全文正则提取 ----------

    if (result.events.length === 0 && result.status === 'Unknown') {
      var fullText = document.body.innerText || '';
      // 从全文中按日期模式切分可能的事件
      var dateRegex = /(\\d{4}[-/]\\d{2}[-/]\\d{2}[\\sT]\\d{2}:\\d{2}(?::\\d{2})?)/g;
      var dateMatches = [];
      var match;
      while ((match = dateRegex.exec(fullText)) !== null) {
        dateMatches.push({ index: match.index, date: match[1] });
      }
      for (var di = 0; di < dateMatches.length; di++) {
        var startIdx = dateMatches[di].index;
        var endIdx = di + 1 < dateMatches.length ? dateMatches[di + 1].index : startIdx + 300;
        var snippet = fullText.substring(startIdx, Math.min(endIdx, startIdx + 300)).trim();
        // 移除日期部分，剩余作为描述
        var eventDesc = snippet.replace(dateMatches[di].date, '').trim();
        if (eventDesc.length > 5) {
          result.events.push({
            time: dateMatches[di].date,
            description: eventDesc.substring(0, 200),
            location: ''
          });
        }
      }

      // 尝试从全文提取状态关键词
      var statusKeywords = [
        { pattern: /deliver/i, status: 'Delivered' },
        { pattern: /in\\s*transit/i, status: 'InTransit' },
        { pattern: /pick\\s*up/i, status: 'PickedUp' },
        { pattern: /已签收/,   status: 'Delivered' },
        { pattern: /运输中|在途/, status: 'InTransit' },
        { pattern: /已揽收|已取件/, status: 'PickedUp' },
        { pattern: /exception|异常/, status: 'Exception' },
      ];
      for (var ki = 0; ki < statusKeywords.length; ki++) {
        if (statusKeywords[ki].pattern.test(fullText)) {
          result.status = statusKeywords[ki].status;
          if (!result.statusDetail) {
            result.statusDetail = result.status;
          }
          break;
        }
      }
    }

    // ---------- 最终处理 ----------

    // 如果匹配到 notFound 关键词且没有有效事件
    if (isNotFound && result.events.length === 0) {
      result.status = 'NotFound';
      result.statusDetail = '未找到该运单的物流信息';
    }

    // 从事件列表提取最近事件信息
    if (result.events.length > 0) {
      result.lastEvent = result.events[0].description;
      result.lastUpdateTime = result.events[0].time;
      // 如果状态仍然未知，但有事件存在，至少标记为 InTransit
      if (result.status === 'Unknown') {
        result.status = 'InTransit';
        result.statusDetail = result.statusDetail || '有物流信息，状态待确认';
      }
    }

    // 如果还在加载中的指示器仍存在，且没有提取到任何有效信息
    if (loadingIndicators.length > 0 && result.events.length === 0 && result.status === 'Unknown') {
      result.status = 'Loading';
      result.statusDetail = '页面仍在加载中';
    }

    sendResult(result);
  } catch(e) {
    // 错误也中继回主窗口
    var errorPayload = JSON.stringify({
      trackingNumber: ${JSON.stringify(trackingNumber)},
      carrier: 'Unknown',
      status: 'Error',
      statusDetail: '采集脚本执行异常: ' + (e.message || String(e)),
      lastEvent: '',
      lastUpdateTime: '',
      events: []
    });
    if (window.__TAURI__ && window.__TAURI__.core) {
      window.__TAURI__.core.invoke('forward_shadow_event', {
        event: '${TRACKING_RESULT_EVENT}',
        payload: errorPayload
      }).catch(function() {});
    } else if (window.__TAURI_INTERNALS__) {
      window.__TAURI_INTERNALS__.invoke('forward_shadow_event', {
        event: '${TRACKING_RESULT_EVENT}',
        payload: errorPayload
      }).catch(function() {});
    }
  }
})();
`;
}

// ==================== TrackingShadowService ====================

export class TrackingShadowService {
  private static readonly DEFAULT_BASE_URL = 'https://t.17track.net/en';

  private config: TrackingConfig;

  /** 影子窗口标签，从 config 读取或使用默认值 */
  private get windowLabel(): string {
    return this.config.windowLabel || 'shadow_17track';
  }

  constructor(config?: TrackingConfig) {
    this.config = config || {};
  }

  /**
   * 查询单个运单号的物流状态
   *
   * 流程：
   * 1. 打开影子窗口，导航到 17track 查询页面（URL hash 自动填入运单号）
   * 2. 等待页面 SPA 渲染完成
   * 3. 轮询注入采集脚本，提取物流信息
   * 4. 返回结构化结果
   * 5. 关闭影子窗口释放资源
   */
  async queryTracking(trackingNumber: string): Promise<TrackingResult> {
    const trimmed = trackingNumber.trim();
    if (!trimmed) {
      return makeEmptyResult(trackingNumber, 'Error', '运单号不能为空');
    }

    // 从 config 读取 URL 模板，支持 ${TRACKING_NUMBERS} 变量
    const targetUrlTemplate = this.config.targetUrl || `${TrackingShadowService.DEFAULT_BASE_URL}#nums=\${TRACKING_NUMBERS}`;
    const url = targetUrlTemplate.replace('${TRACKING_NUMBERS}', encodeURIComponent(trimmed));
    console.log(`${LOG_PREFIX} queryTracking start: ${trimmed}`);

    try {
      // 1. 打开影子窗口
      await invoke('open_shadow_window', {
        label: this.windowLabel,
        url: url,
      });
      console.log(`${LOG_PREFIX} Shadow window opened: ${url}`);

      // 2. 等待 17track SPA 渲染（React/Next.js 水合 + 数据请求）
      await new Promise(r => setTimeout(r, this.config.timings?.initialWaitMs ?? 5000));

      // 3. 轮询采集结果
      const maxPollAttempts = this.config.timings?.maxPollAttempts ?? 20;
      let result: TrackingResult | null = null;
      for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
        console.log(`${LOG_PREFIX} Extract attempt ${attempt + 1}/${maxPollAttempts}`);
        result = await this.tryExtractResult(trimmed);

        if (result && result.status !== 'Loading') {
          console.log(`${LOG_PREFIX} Got result: status=${result.status}, events=${result.events.length}`);
          break;
        }

        // 还在加载，等待后重试
        await new Promise(r => setTimeout(r, this.config.timings?.pollIntervalMs ?? 1500));
      }

      // 4. 返回结果或默认值
      return result || makeEmptyResult(trimmed);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`${LOG_PREFIX} queryTracking error:`, errMsg);
      return makeEmptyResult(trimmed, 'Error', `查询异常: ${errMsg}`);
    } finally {
      // 5. 确保关闭影子窗口释放资源
      await invoke('close_shadow_window', {
        label: this.windowLabel,
      }).catch((e: unknown) => {
        console.warn(`${LOG_PREFIX} close_shadow_window failed (may already be closed):`, e);
      });
      console.log(`${LOG_PREFIX} Shadow window closed.`);
    }
  }

  /**
   * 批量查询多个运单号（串行执行，避免触发反爬）
   *
   * 每次查询之间间隔 BATCH_DELAY_MS 毫秒。
   * 如果某个运单查询失败，不会中断后续查询。
   */
  async queryMultiple(trackingNumbers: string[]): Promise<TrackingResult[]> {
    const results: TrackingResult[] = [];
    const total = trackingNumbers.length;

    console.log(`${LOG_PREFIX} queryMultiple start: ${total} tracking number(s)`);

    for (let i = 0; i < total; i++) {
      const num = trackingNumbers[i];
      console.log(`${LOG_PREFIX} Querying [${i + 1}/${total}]: ${num}`);

      const result = await this.queryTracking(num);
      results.push(result);

      // 查询间隔（最后一个不需要等待）
      if (i < total - 1) {
        const batchDelayMs = this.config.timings?.batchDelayMs ?? 2000;
        console.log(`${LOG_PREFIX} Waiting ${batchDelayMs}ms before next query...`);
        await new Promise(r => setTimeout(r, batchDelayMs));
      }
    }

    console.log(`${LOG_PREFIX} queryMultiple complete: ${results.length} result(s)`);
    return results;
  }

  // ==================== 私有方法 ====================

  /**
   * 尝试从影子窗口提取物流结果
   *
   * 1. 注册一次性事件监听器（17track-result）
   * 2. 注入采集脚本到影子窗口
   * 3. 等待事件回调或超时
   * 4. 解析并返回结果
   */
  private async tryExtractResult(trackingNumber: string): Promise<TrackingResult | null> {
    return new Promise<TrackingResult | null>(async (resolve) => {
      let resultReceived = false;
      let unlisten: (() => void) | null = null;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      try {
        // 1. 监听中继事件
        unlisten = await listen<string>(TRACKING_RESULT_EVENT, (e) => {
          if (resultReceived) return; // 防止重复处理
          resultReceived = true;

          try {
            const parsed = JSON.parse(e.payload) as TrackingResult;
            resolve(parsed);
          } catch (parseErr) {
            console.warn(`${LOG_PREFIX} Failed to parse tracking result:`, parseErr);
            resolve(null);
          }

          // 清理
          if (timeoutId) clearTimeout(timeoutId);
          if (unlisten) unlisten();
        });

        // 2. 注入采集脚本（传入配置的 captcha 关键词）
        const captchaKeywords = this.config.extractionConfig?.captchaKeywords;
        const extractScript = buildExtractScript(trackingNumber, captchaKeywords);
        await invoke('execute_shadow_js', {
          label: this.windowLabel,
          script: extractScript,
        });

        // 3. 超时处理（从配置读取等待超时）
        const extractTimeoutMs = this.config.extractionConfig?.waitForResultMs ?? (this.config.timings?.extractTimeoutMs ?? 3000);
        timeoutId = setTimeout(() => {
          if (!resultReceived) {
            resultReceived = true;
            console.warn(`${LOG_PREFIX} tryExtractResult timeout (${extractTimeoutMs}ms)`);
            if (unlisten) unlisten();
            resolve(null);
          }
        }, extractTimeoutMs);
      } catch (err) {
        console.error(`${LOG_PREFIX} tryExtractResult error:`, err);
        if (!resultReceived) {
          resultReceived = true;
          if (timeoutId) clearTimeout(timeoutId);
          if (unlisten) unlisten();
          resolve(null);
        }
      }
    });
  }
}
