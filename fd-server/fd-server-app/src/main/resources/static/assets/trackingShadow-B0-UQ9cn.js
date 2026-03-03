import{invoke as m}from"./core-BEOw45JP.js";import{l as v}from"./event-C7SUnCvf.js";const a="[TrackingShadow]",p=["captcha","验证码","robot","blocked"],c="17track-result";function w(u,n="NotFound",t="未能获取物流信息"){return{trackingNumber:u,carrier:"Unknown",status:n,statusDetail:t,lastEvent:"",lastUpdateTime:"",events:[]}}function g(u,n){const t=n||p;return`
(function() {
  try {
    var trackingNumber = ${JSON.stringify(u)};
    var captchaKeywords = ${JSON.stringify(t)};

    // ---------- 辅助函数 ----------

    function trim(s) { return (s || '').replace(/\\s+/g, ' ').trim(); }

    function sendResult(result) {
      var payload = JSON.stringify(result);
      if (window.__TAURI__ && window.__TAURI__.core) {
        window.__TAURI__.core.invoke('forward_shadow_event', {
          event: '${c}',
          payload: payload
        }).catch(function() {});
      } else if (window.__TAURI_INTERNALS__) {
        window.__TAURI_INTERNALS__.invoke('forward_shadow_event', {
          event: '${c}',
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
      trackingNumber: ${JSON.stringify(u)},
      carrier: 'Unknown',
      status: 'Error',
      statusDetail: '采集脚本执行异常: ' + (e.message || String(e)),
      lastEvent: '',
      lastUpdateTime: '',
      events: []
    });
    if (window.__TAURI__ && window.__TAURI__.core) {
      window.__TAURI__.core.invoke('forward_shadow_event', {
        event: '${c}',
        payload: errorPayload
      }).catch(function() {});
    } else if (window.__TAURI_INTERNALS__) {
      window.__TAURI_INTERNALS__.invoke('forward_shadow_event', {
        event: '${c}',
        payload: errorPayload
      }).catch(function() {});
    }
  }
})();
`}class f{static DEFAULT_BASE_URL="https://t.17track.net/en";config;get windowLabel(){return this.config.windowLabel||"shadow_17track"}constructor(n){this.config=n||{}}async queryTracking(n){const t=n.trim();if(!t)return w(n,"Error","运单号不能为空");const s=(this.config.targetUrl||`${f.DEFAULT_BASE_URL}#nums=\${TRACKING_NUMBERS}`).replace("${TRACKING_NUMBERS}",encodeURIComponent(t));console.log(`${a} queryTracking start: ${t}`);try{await m("open_shadow_window",{label:this.windowLabel,url:s}),console.log(`${a} Shadow window opened: ${s}`),await new Promise(l=>setTimeout(l,this.config.timings?.initialWaitMs??5e3));const e=this.config.timings?.maxPollAttempts??20;let r=null;for(let l=0;l<e;l++){if(console.log(`${a} Extract attempt ${l+1}/${e}`),r=await this.tryExtractResult(t),r&&r.status!=="Loading"){console.log(`${a} Got result: status=${r.status}, events=${r.events.length}`);break}await new Promise(o=>setTimeout(o,this.config.timings?.pollIntervalMs??1500))}return r||w(t)}catch(e){const r=e instanceof Error?e.message:String(e);return console.error(`${a} queryTracking error:`,r),w(t,"Error",`查询异常: ${r}`)}finally{await m("close_shadow_window",{label:this.windowLabel}).catch(e=>{console.warn(`${a} close_shadow_window failed (may already be closed):`,e)}),console.log(`${a} Shadow window closed.`)}}async queryMultiple(n){const t=[],i=n.length;console.log(`${a} queryMultiple start: ${i} tracking number(s)`);for(let s=0;s<i;s++){const e=n[s];console.log(`${a} Querying [${s+1}/${i}]: ${e}`);const r=await this.queryTracking(e);if(t.push(r),s<i-1){const l=this.config.timings?.batchDelayMs??2e3;console.log(`${a} Waiting ${l}ms before next query...`),await new Promise(o=>setTimeout(o,l))}}return console.log(`${a} queryMultiple complete: ${t.length} result(s)`),t}async tryExtractResult(n){return new Promise(async t=>{let i=!1,s=null,e=null;try{s=await v(c,h=>{if(!i){i=!0;try{const d=JSON.parse(h.payload);t(d)}catch(d){console.warn(`${a} Failed to parse tracking result:`,d),t(null)}e&&clearTimeout(e),s&&s()}});const r=this.config.extractionConfig?.captchaKeywords,l=g(n,r);await m("execute_shadow_js",{label:this.windowLabel,script:l});const o=this.config.extractionConfig?.waitForResultMs??this.config.timings?.extractTimeoutMs??3e3;e=setTimeout(()=>{i||(i=!0,console.warn(`${a} tryExtractResult timeout (${o}ms)`),s&&s(),t(null))},o)}catch(r){console.error(`${a} tryExtractResult error:`,r),i||(i=!0,e&&clearTimeout(e),s&&s(),t(null))}})}}export{f as TrackingShadowService};
