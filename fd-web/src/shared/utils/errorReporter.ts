/**
 * 前端错误上报基础设施
 *
 * 功能：
 * - 全局 window.onerror + unhandledrejection 监听
 * - 错误信息收集：message, stack, url, line, column
 * - 错误去重：相同 message 在 DEDUP_INTERVAL_MS 内不重复上报
 * - 当前阶段上报到控制台，预留 API 上报接口
 * - 提供 React ErrorBoundary 集成辅助方法
 */

// --- 类型定义 ---

interface ErrorReport {
  /** 错误消息 */
  message: string;
  /** 错误堆栈 */
  stack?: string;
  /** 发生错误的脚本 URL */
  source?: string;
  /** 行号 */
  line?: number;
  /** 列号 */
  column?: number;
  /** 错误类型标签 */
  type: 'runtime' | 'unhandledrejection' | 'react-boundary';
  /** 错误发生时间 (ISO) */
  timestamp: string;
  /** 当前页面 URL */
  pageUrl: string;
  /** 用户代理 */
  userAgent: string;
}

// --- 配置 ---

/** 相同 message 的去重间隔（毫秒） */
const DEDUP_INTERVAL_MS = 5000;

/** 已上报错误的去重缓存：message -> 上次上报时间戳 */
const recentErrors = new Map<string, number>();

// --- 核心函数 ---

/**
 * 检查是否应该上报该错误（去重逻辑）
 */
function shouldReport(message: string): boolean {
  const now = Date.now();
  const lastReported = recentErrors.get(message);

  if (lastReported && now - lastReported < DEDUP_INTERVAL_MS) {
    return false;
  }

  recentErrors.set(message, now);

  // 定期清理过期条目，防止内存泄漏
  if (recentErrors.size > 100) {
    for (const [key, time] of recentErrors) {
      if (now - time > DEDUP_INTERVAL_MS) {
        recentErrors.delete(key);
      }
    }
  }

  return true;
}

/**
 * 上报错误（当前阶段：控制台输出）
 *
 * 预留 API 上报接口，后续可替换为 fetch POST 到后端
 */
function reportError(report: ErrorReport): void {
  if (!shouldReport(report.message)) {
    return;
  }

  // --- 当前阶段：控制台上报 ---
  console.error(
    `[ErrorReporter] ${report.type} | ${report.message}`,
    {
      source: report.source,
      line: report.line,
      column: report.column,
      stack: report.stack,
      timestamp: report.timestamp,
      pageUrl: report.pageUrl,
    }
  );

  // --- 预留：API 上报接口 ---
  // 取消下面的注释并配置端点即可启用远程上报
  //
  // try {
  //   fetch('/api/v1/client-errors', {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify(report),
  //   }).catch(() => {
  //     // 上报失败时静默忽略，避免无限循环
  //   });
  // } catch {
  //   // 静默忽略
  // }
}

/**
 * 构造基础报告字段
 */
function createBaseReport(
  type: ErrorReport['type'],
  message: string
): ErrorReport {
  return {
    message,
    type,
    timestamp: new Date().toISOString(),
    pageUrl: typeof window !== 'undefined' ? window.location.href : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  };
}

// --- 全局监听器 ---

/**
 * window.onerror 处理器
 */
function handleWindowError(
  event: string | Event,
  source?: string,
  line?: number,
  column?: number,
  error?: Error
): void {
  const message =
    error?.message || (typeof event === 'string' ? event : 'Unknown error');

  const report: ErrorReport = {
    ...createBaseReport('runtime', message),
    stack: error?.stack,
    source,
    line,
    column,
  };

  reportError(report);
}

/**
 * unhandledrejection 处理器
 */
function handleUnhandledRejection(event: PromiseRejectionEvent): void {
  const reason = event.reason;
  let message = 'Unhandled Promise Rejection';
  let stack: string | undefined;

  if (reason instanceof Error) {
    message = reason.message;
    stack = reason.stack;
  } else if (typeof reason === 'string') {
    message = reason;
  } else if (reason !== null && reason !== undefined) {
    try {
      message = JSON.stringify(reason);
    } catch {
      message = String(reason);
    }
  }

  const report: ErrorReport = {
    ...createBaseReport('unhandledrejection', message),
    stack,
  };

  reportError(report);
}

// --- 公共 API ---

/**
 * 初始化全局错误监听。
 * 在应用入口（如 main.tsx）调用一次即可。
 */
export function initErrorReporter(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.onerror = handleWindowError;
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
}

/**
 * 销毁全局错误监听（用于测试或热更新清理）。
 */
export function destroyErrorReporter(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.onerror = null;
  window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  recentErrors.clear();
}

/**
 * React ErrorBoundary 集成方法。
 * 在 ErrorBoundary 的 componentDidCatch 中调用。
 *
 * @example
 * ```tsx
 * componentDidCatch(error: Error, errorInfo: ErrorInfo) {
 *   reportReactError(error, errorInfo.componentStack);
 * }
 * ```
 */
export function reportReactError(
  error: Error,
  componentStack?: string | null
): void {
  const report: ErrorReport = {
    ...createBaseReport('react-boundary', error.message),
    stack: error.stack
      ? error.stack + (componentStack ? `\n\nComponent Stack:${componentStack}` : '')
      : componentStack || undefined,
  };

  reportError(report);
}

/**
 * 手动上报错误（供业务代码主动调用）。
 *
 * @example
 * ```ts
 * try {
 *   await riskyOperation();
 * } catch (err) {
 *   manualReportError(err instanceof Error ? err : new Error(String(err)));
 * }
 * ```
 */
export function manualReportError(error: Error): void {
  const report: ErrorReport = {
    ...createBaseReport('runtime', error.message),
    stack: error.stack,
  };

  reportError(report);
}
