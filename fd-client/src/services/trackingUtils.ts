import type { TrackingResult } from './trackingShadow';

/**
 * 运单号提取 + 物流工单检测 + 物流上下文格式化 工具集
 *
 * 纯函数，不依赖 Tauri 或任何平台 API。
 */

/**
 * 从文本中提取运单号
 *
 * 优先从 17track URL 提取（最可靠），然后匹配常见物流单号格式。
 * 返回去重后的运单号数组。
 */
export function extractTrackingNumbers(text: string): string[] {
    const numbers = new Set<string>();

    // 1. 从 17track URL 提取（最高优先级）
    const urlPattern = /17track\.net[^\s]*?nums=([A-Za-z0-9,]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = urlPattern.exec(text)) !== null) {
        match[1].split(',').forEach(n => {
            const trimmed = n.trim();
            if (trimmed) numbers.add(trimmed);
        });
    }

    // 2. 从 DHL/顺丰等常见格式提取
    const carrierPatterns: RegExp[] = [
        /\b(SF\d{13,15})\b/g,              // 顺丰
        /\b(YT\d{13,18})\b/g,              // 圆通
        /\b(LP\d{14,})\b/g,                // Yanwen
        /\b(\d{10,22})\b/g,                // 通用长数字（慎用）
        /\b([A-Z]{2}\d{9}[A-Z]{2})\b/g,    // 国际邮政格式
    ];

    for (const pattern of carrierPatterns) {
        while ((match = pattern.exec(text)) !== null) {
            // 过滤明显不是运单号的（太短、纯 10 位数字可能是工单 ID 等）
            const candidate = match[1];
            if (candidate.length >= 10 && !/^\d{10}$/.test(candidate)) {
                numbers.add(candidate);
            }
        }
    }

    return [...numbers];
}

/**
 * 检测工单是否为物流相关
 *
 * 基于关键词匹配工单标题和对话内容。
 */
export function isLogisticsRelated(subject: string, content: string): boolean {
    const keywords = [
        // 英文
        'shipping', 'tracking', 'delivery', 'shipped', 'package', 'parcel',
        'where is my order', 'when will i receive', 'transit', 'courier',
        'logistics', 'shipment', 'track my order', 'has been shipped',
        'delivery status', 'estimated delivery',
        // 中文
        '物流', '快递', '运单', '追踪', '发货', '到货', '签收', '配送',
        '包裹', '揽收', '在途', '寄件',
    ];

    const combined = (subject + ' ' + content).toLowerCase();
    return keywords.some(kw => combined.includes(kw));
}

/**
 * 将物流查询结果格式化为 AI 上下文文本
 *
 * 如果没有结果，返回空字符串。
 */
export function formatTrackingContext(results: TrackingResult[]): string {
    if (results.length === 0) return '';

    let section = '\n\n【REAL-TIME LOGISTICS STATUS】:\n';
    section += '==========================================================\n';

    for (const r of results) {
        section += `Tracking Number: ${r.trackingNumber}\n`;
        section += `Carrier: ${r.carrier}\n`;
        section += `Status: ${r.status} — ${r.statusDetail}\n`;

        if (r.lastEvent) {
            section += `Latest Event: [${r.lastUpdateTime}] ${r.lastEvent}\n`;
        }

        if (r.events.length > 0) {
            section += `Recent Events (latest ${Math.min(r.events.length, 5)}):\n`;
            r.events.slice(0, 5).forEach(evt => {
                section += `  • [${evt.time}] ${evt.description}`;
                if (evt.location) section += ` (${evt.location})`;
                section += '\n';
            });
        }

        section += '==========================================================\n';
    }

    section += 'IMPORTANT: Base your reply on the REAL tracking data above. Do NOT fabricate tracking information.\n';
    return section;
}
