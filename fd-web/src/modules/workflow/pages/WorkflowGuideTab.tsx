import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    GitBranch, Bot, Users, ArrowRight, ArrowDown,
    Cpu, Globe, Monitor, Server, Zap, RefreshCw,
    CheckCircle, XCircle, Clock, Play, Pause,
    ChevronDown, ChevronRight, ExternalLink,
} from 'lucide-react';

/* ─── 可折叠面板 ─── */
const Collapsible: React.FC<{
    title: string;
    icon: React.ReactNode;
    defaultOpen?: boolean;
    children: React.ReactNode;
    badge?: string;
}> = ({ title, icon, defaultOpen = false, children, badge }) => {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="border border-white/10 rounded-lg overflow-hidden">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center gap-3 px-4 py-3 bg-slate-800/50 hover:bg-slate-800 transition-colors text-left"
            >
                {icon}
                <span className="font-medium text-white flex-1">{title}</span>
                {badge && (
                    <span className="px-2 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-300">
                        {badge}
                    </span>
                )}
                {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
            </button>
            {open && <div className="px-4 py-4 bg-slate-900/30">{children}</div>}
        </div>
    );
};

/* ─── 流程节点组件 ─── */
const FlowNode: React.FC<{
    label: string;
    type: 'start' | 'end' | 'agent' | 'gateway' | 'wait' | 'callback' | 'human';
    sublabel?: string;
    active?: boolean;
}> = ({ label, type, sublabel, active }) => {
    const styles: Record<string, string> = {
        start: 'bg-green-500/20 border-green-500/50 text-green-300',
        end: 'bg-red-500/20 border-red-500/50 text-red-300',
        agent: 'bg-blue-500/20 border-blue-500/50 text-blue-300',
        gateway: 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300',
        wait: 'bg-purple-500/20 border-purple-500/50 text-purple-300',
        callback: 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300',
        human: 'bg-orange-500/20 border-orange-500/50 text-orange-300',
    };
    const icons: Record<string, React.ReactNode> = {
        start: <Play className="w-3.5 h-3.5" />,
        end: <CheckCircle className="w-3.5 h-3.5" />,
        agent: <Bot className="w-3.5 h-3.5" />,
        gateway: <GitBranch className="w-3.5 h-3.5" />,
        wait: <Pause className="w-3.5 h-3.5" />,
        callback: <Zap className="w-3.5 h-3.5" />,
        human: <Users className="w-3.5 h-3.5" />,
    };
    return (
        <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium ${styles[type]} ${active ? 'ring-2 ring-white/30' : ''}`}>
            {icons[type]}
            <span>{label}</span>
            {sublabel && <span className="text-[10px] opacity-60">({sublabel})</span>}
        </div>
    );
};

const FlowArrow: React.FC<{ label?: string; vertical?: boolean }> = ({ label, vertical }) => (
    <div className={`flex items-center gap-1 ${vertical ? 'flex-col py-1' : 'px-1'}`}>
        {vertical
            ? <ArrowDown className="w-3.5 h-3.5 text-slate-500" />
            : <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
        }
        {label && <span className="text-[10px] text-slate-500">{label}</span>}
    </div>
);

/* ─── Provider 类型卡片 ─── */
const ProviderCard: React.FC<{
    type: string;
    icon: React.ReactNode;
    title: string;
    desc: string;
    env: string;
    example: string;
}> = ({ icon, title, desc, env, example }) => (
    <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4 space-y-2">
        <div className="flex items-center gap-2">
            {icon}
            <span className="font-medium text-white text-sm">{title}</span>
        </div>
        <p className="text-xs text-slate-400">{desc}</p>
        <div className="flex items-center gap-2">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{env}</span>
        </div>
        <div className="text-[11px] text-slate-500 font-mono bg-slate-900/50 rounded px-2 py-1">
            {example}
        </div>
    </div>
);

/* ─── 主组件 ─── */
const WorkflowGuideTab: React.FC = () => {
    const { t } = useTranslation('common');

    return (
        <div className="flex-1 overflow-auto">
            <div className="max-w-5xl mx-auto p-6 space-y-6">
                {/* 页面标题 */}
                <div className="space-y-2">
                    <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                        <GitBranch className="w-7 h-7 text-purple-400" />
                        {t('nav.workflowGuide')}
                    </h1>
                    <p className="text-sm text-slate-400">
                        Flowable BPMN 2.0 工作流引擎使用指南 — 流程设计、Agent 接入、异步等待/唤醒机制详解
                    </p>
                </div>

                {/* ── 1. 架构概览 ── */}
                <Collapsible
                    title="架构概览"
                    icon={<Server className="w-5 h-5 text-purple-400" />}
                    defaultOpen
                    badge="Overview"
                >
                    <div className="space-y-4">
                        <p className="text-sm text-slate-300">
                            工作流引擎运行在服务端（fd-server），基于 Flowable BPMN 2.0 嵌入式引擎。
                            管理员可在前端通过 bpmn-js 可视化编辑器设计流程，部署后由引擎自动执行。
                        </p>

                        {/* 架构图 */}
                        <div className="bg-slate-800/30 border border-white/5 rounded-lg p-5 space-y-4">
                            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">数据流架构</h3>

                            {/* 前端层 */}
                            <div className="space-y-2">
                                <div className="text-xs text-slate-500 font-medium">前端 (fd-web)</div>
                                <div className="flex items-center gap-3 flex-wrap">
                                    <div className="px-3 py-2 bg-indigo-500/10 border border-indigo-500/30 rounded-lg text-xs text-indigo-300 space-y-0.5">
                                        <div className="font-semibold">BPMN 编辑器</div>
                                        <div className="text-[10px] opacity-60">bpmn-js 可视化设计</div>
                                    </div>
                                    <div className="px-3 py-2 bg-indigo-500/10 border border-indigo-500/30 rounded-lg text-xs text-indigo-300 space-y-0.5">
                                        <div className="font-semibold">任务消费器</div>
                                        <div className="text-[10px] opacity-60">REST claim + SSE 推送</div>
                                    </div>
                                    <div className="px-3 py-2 bg-indigo-500/10 border border-indigo-500/30 rounded-lg text-xs text-indigo-300 space-y-0.5">
                                        <div className="font-semibold">Agent 运行时</div>
                                        <div className="text-[10px] opacity-60">Executor 执行 Agent</div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 text-slate-600">
                                <div className="flex-1 border-t border-dashed border-slate-700" />
                                <span className="text-[10px]">REST API + SSE</span>
                                <div className="flex-1 border-t border-dashed border-slate-700" />
                            </div>

                            {/* 服务端层 */}
                            <div className="space-y-2">
                                <div className="text-xs text-slate-500 font-medium">服务端 (fd-server)</div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                    <div className="px-3 py-2 bg-purple-500/10 border border-purple-500/30 rounded-lg text-xs text-purple-300 space-y-0.5">
                                        <div className="font-semibold">Flowable 引擎</div>
                                        <div className="text-[10px] opacity-60">BPMN 流程执行</div>
                                    </div>
                                    <div className="px-3 py-2 bg-blue-500/10 border border-blue-500/30 rounded-lg text-xs text-blue-300 space-y-0.5">
                                        <div className="font-semibold">JavaDelegate</div>
                                        <div className="text-[10px] opacity-60">Agent / Human / Callback</div>
                                    </div>
                                    <div className="px-3 py-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-xs text-cyan-300 space-y-0.5">
                                        <div className="font-semibold">TaskBridge</div>
                                        <div className="text-[10px] opacity-60">任务完成 → 唤醒流程</div>
                                    </div>
                                    <div className="px-3 py-2 bg-green-500/10 border border-green-500/30 rounded-lg text-xs text-green-300 space-y-0.5">
                                        <div className="font-semibold">SSE 推送</div>
                                        <div className="text-[10px] opacity-60">实时状态通知</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 双轨模式 */}
                        <div className="bg-slate-800/30 border border-white/5 rounded-lg p-4">
                            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">双轨编排模式</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="p-3 rounded-lg bg-slate-700/30 border border-white/5">
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="w-2 h-2 rounded-full bg-yellow-400" />
                                        <span className="text-sm font-medium text-white">Legacy 模式</span>
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-300">默认</span>
                                    </div>
                                    <p className="text-xs text-slate-400">
                                        硬编码状态转换，直接创建 TaskInstance。配置：<code className="text-yellow-300 bg-slate-800 px-1 rounded">fd.workflow.enabled=false</code>
                                    </p>
                                </div>
                                <div className="p-3 rounded-lg bg-slate-700/30 border border-white/5">
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="w-2 h-2 rounded-full bg-purple-400" />
                                        <span className="text-sm font-medium text-white">Flowable 模式</span>
                                    </div>
                                    <p className="text-xs text-slate-400">
                                        BPMN 引擎驱动，可视化编排。配置：<code className="text-purple-300 bg-slate-800 px-1 rounded">fd.workflow.enabled=true</code>
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </Collapsible>

                {/* ── 2. 标准工单流程 ── */}
                <Collapsible
                    title="标准工单流程"
                    icon={<RefreshCw className="w-5 h-5 text-cyan-400" />}
                    defaultOpen
                    badge="ticket-standard-flow"
                >
                    <div className="space-y-5">
                        <p className="text-sm text-slate-300">
                            内置标准工单处理流程，包含翻译、回复、审核三个阶段。审核驳回时自动循环回到回复阶段。
                        </p>

                        {/* 整体流程图 */}
                        <div className="bg-slate-800/30 border border-white/5 rounded-lg p-5 overflow-x-auto">
                            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">完整流程</h3>
                            <div className="flex items-center gap-1 min-w-max">
                                <FlowNode label="START" type="start" />
                                <FlowArrow />
                                <FlowNode label="翻译" type="agent" sublabel="gemini-translate" />
                                <FlowArrow />
                                <FlowNode label="环境?" type="gateway" />
                                <FlowArrow label="CLIENT" />
                                <FlowNode label="等待翻译" type="wait" />
                                <FlowArrow />
                                <FlowNode label="翻译完成" type="callback" />
                                <FlowArrow />
                                <FlowNode label="回复" type="agent" sublabel="notebooklm-reply" />
                                <FlowArrow />
                                <FlowNode label="环境?" type="gateway" />
                                <FlowArrow label="CLIENT" />
                                <FlowNode label="等待回复" type="wait" />
                                <FlowArrow />
                                <FlowNode label="回复完成" type="callback" />
                                <FlowArrow />
                                <FlowNode label="创建审核" type="human" />
                                <FlowArrow />
                                <FlowNode label="等待审核" type="wait" />
                                <FlowArrow />
                                <FlowNode label="结果?" type="gateway" />
                            </div>
                            <div className="mt-3 ml-[calc(100%-220px)] flex flex-col gap-2">
                                <div className="flex items-center gap-1">
                                    <span className="text-[10px] text-green-400 w-12">PASS</span>
                                    <ArrowRight className="w-3 h-3 text-green-400" />
                                    <FlowNode label="审核通过" type="callback" />
                                    <FlowArrow />
                                    <FlowNode label="END" type="end" />
                                </div>
                                <div className="flex items-center gap-1">
                                    <span className="text-[10px] text-red-400 w-12">REJECT</span>
                                    <ArrowRight className="w-3 h-3 text-red-400" />
                                    <FlowNode label="审核驳回" type="callback" />
                                    <ArrowRight className="w-3 h-3 text-red-400" />
                                    <span className="text-[10px] text-red-400 flex items-center gap-1">
                                        <RefreshCw className="w-3 h-3" /> 循环回到「回复」
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* 节点图例 */}
                        <div className="bg-slate-800/30 border border-white/5 rounded-lg p-4">
                            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">节点图例</h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <div className="flex items-center gap-2">
                                    <FlowNode label="Agent 任务" type="agent" />
                                    <span className="text-[10px] text-slate-500">ServiceTask</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <FlowNode label="人工任务" type="human" />
                                    <span className="text-[10px] text-slate-500">ServiceTask</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <FlowNode label="等待信号" type="wait" />
                                    <span className="text-[10px] text-slate-500">ReceiveTask</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <FlowNode label="业务回调" type="callback" />
                                    <span className="text-[10px] text-slate-500">ServiceTask</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <FlowNode label="条件网关" type="gateway" />
                                    <span className="text-[10px] text-slate-500">ExclusiveGateway</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <FlowNode label="START" type="start" />
                                    <span className="text-[10px] text-slate-500">StartEvent</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <FlowNode label="END" type="end" />
                                    <span className="text-[10px] text-slate-500">EndEvent</span>
                                </div>
                            </div>
                        </div>

                        {/* 三个阶段详解 */}
                        <div className="space-y-3">
                            {/* 翻译阶段 */}
                            <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4">
                                <h4 className="text-sm font-semibold text-blue-300 mb-2">Phase 1: 翻译阶段</h4>
                                <div className="flex items-start gap-2 flex-wrap">
                                    <FlowNode label="translate_agent" type="agent" sublabel="gemini-translate" />
                                    <FlowArrow />
                                    <FlowNode label="translate_env_gw" type="gateway" />
                                    <FlowArrow />
                                    <FlowNode label="translate_wait" type="wait" />
                                    <FlowArrow />
                                    <FlowNode label="translation_done_cb" type="callback" />
                                </div>
                                <p className="text-xs text-slate-400 mt-2">
                                    AgentTaskDelegate 读取 <code className="text-blue-300">agentCode=gemini-translate</code>，
                                    若 Agent 为 CLIENT_ONLY 则创建 TaskInstance 后进入 ReceiveTask 等待；
                                    SERVER_ONLY 则直接执行跳过等待。翻译完成后触发 <code className="text-cyan-300">ticket.translationDone</code> 回调。
                                </p>
                            </div>

                            {/* 回复阶段 */}
                            <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-4">
                                <h4 className="text-sm font-semibold text-green-300 mb-2">Phase 2: 回复阶段</h4>
                                <div className="flex items-start gap-2 flex-wrap">
                                    <FlowNode label="reply_agent" type="agent" sublabel="notebooklm-reply" />
                                    <FlowArrow />
                                    <FlowNode label="reply_env_gw" type="gateway" />
                                    <FlowArrow />
                                    <FlowNode label="reply_wait" type="wait" />
                                    <FlowArrow />
                                    <FlowNode label="reply_done_cb" type="callback" />
                                </div>
                                <p className="text-xs text-slate-400 mt-2">
                                    结构与翻译阶段相同。Agent 为 <code className="text-green-300">notebooklm-reply</code>。
                                    完成后触发 <code className="text-cyan-300">ticket.replyDone</code> 回调。
                                    审核驳回时流程会循环回到此阶段。
                                </p>
                            </div>

                            {/* 审核阶段 */}
                            <div className="bg-orange-500/5 border border-orange-500/20 rounded-lg p-4">
                                <h4 className="text-sm font-semibold text-orange-300 mb-2">Phase 3: 审核阶段</h4>
                                <div className="flex items-start gap-2 flex-wrap">
                                    <FlowNode label="audit_create" type="human" sublabel="ticket.audit" />
                                    <FlowArrow />
                                    <FlowNode label="audit_wait" type="wait" />
                                    <FlowArrow />
                                    <FlowNode label="audit_result_gw" type="gateway" />
                                </div>
                                <div className="mt-2 ml-4 space-y-1">
                                    <div className="flex items-center gap-2">
                                        <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                                        <span className="text-xs text-green-300">PASS</span>
                                        <ArrowRight className="w-3 h-3 text-slate-500" />
                                        <span className="text-xs text-slate-400">ticket.auditPass 回调 → 流程结束</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <XCircle className="w-3.5 h-3.5 text-red-400" />
                                        <span className="text-xs text-red-300">REJECT</span>
                                        <ArrowRight className="w-3 h-3 text-slate-500" />
                                        <span className="text-xs text-slate-400">ticket.auditReject 回调 → 循环回到 reply_agent</span>
                                    </div>
                                </div>
                                <p className="text-xs text-slate-400 mt-2">
                                    HumanTaskDelegate 创建审核任务（<code className="text-orange-300">humanTaskType=ticket.audit</code>），
                                    流程进入 ReceiveTask 等待人工完成。审核通过则结束流程，驳回则回到回复阶段重新生成回复。
                                </p>
                            </div>
                        </div>
                    </div>
                </Collapsible>

                {/* ── 3. 三种 Delegate 桥接 ── */}
                <Collapsible
                    title="三种 JavaDelegate 桥接"
                    icon={<Cpu className="w-5 h-5 text-blue-400" />}
                    badge="核心机制"
                >
                    <div className="space-y-4">
                        <p className="text-sm text-slate-300">
                            Flowable 引擎通过 JavaDelegate 将 BPMN ServiceTask 桥接到实际业务逻辑。
                            系统提供 3 种 Delegate 实现，覆盖 Agent 执行、人工任务、业务回调三种场景。
                        </p>

                        {/* AgentTaskDelegate */}
                        <div className="bg-slate-800/30 border border-white/5 rounded-lg p-4 space-y-3">
                            <div className="flex items-center gap-2">
                                <Bot className="w-5 h-5 text-blue-400" />
                                <h4 className="font-semibold text-white">AgentTaskDelegate</h4>
                                <code className="text-xs bg-slate-800 px-2 py-0.5 rounded text-blue-300">${'${agentTaskDelegate}'}</code>
                            </div>
                            <p className="text-xs text-slate-400">
                                根据 Agent 定义的 <code className="text-blue-300">executionEnv</code> 自动决定执行路径：
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="p-3 rounded bg-slate-800/50 border border-blue-500/20">
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <Monitor className="w-4 h-4 text-blue-300" />
                                        <span className="text-xs font-semibold text-blue-300">CLIENT_ONLY</span>
                                    </div>
                                    <ol className="text-[11px] text-slate-400 space-y-1 list-decimal list-inside">
                                        <li>创建 TaskInstance（类型 <code>workflow.agent.{'{agentCode}'}</code>）</li>
                                        <li>设置流程变量 <code>pendingTaskType</code></li>
                                        <li>后续 ReceiveTask 暂停流程</li>
                                        <li>客户端通过 REST claim 领取任务</li>
                                        <li>执行完成后 WorkflowTaskBridge 唤醒流程</li>
                                    </ol>
                                </div>
                                <div className="p-3 rounded bg-slate-800/50 border border-green-500/20">
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <Server className="w-4 h-4 text-green-300" />
                                        <span className="text-xs font-semibold text-green-300">SERVER_ONLY / BOTH</span>
                                    </div>
                                    <ol className="text-[11px] text-slate-400 space-y-1 list-decimal list-inside">
                                        <li>设置 <code>pendingTaskType = null</code></li>
                                        <li>调用 <code>agentDispatchService.executeOnServer()</code></li>
                                        <li>结果写入流程变量 <code>agentSuccess</code>/<code>agentResult</code></li>
                                        <li>流程继续执行（跳过 ReceiveTask）</li>
                                    </ol>
                                </div>
                            </div>
                            <div className="bg-slate-900/50 rounded p-3">
                                <div className="text-[10px] text-slate-500 mb-1">BPMN XML 配置示例</div>
                                <pre className="text-[11px] text-slate-300 font-mono whitespace-pre-wrap">{`<serviceTask id="translate_agent"
  flowable:delegateExpression="\${agentTaskDelegate}">
  <extensionElements>
    <flowable:field name="agentCode"
      stringValue="gemini-translate"/>
  </extensionElements>
</serviceTask>`}</pre>
                            </div>
                        </div>

                        {/* HumanTaskDelegate */}
                        <div className="bg-slate-800/30 border border-white/5 rounded-lg p-4 space-y-3">
                            <div className="flex items-center gap-2">
                                <Users className="w-5 h-5 text-orange-400" />
                                <h4 className="font-semibold text-white">HumanTaskDelegate</h4>
                                <code className="text-xs bg-slate-800 px-2 py-0.5 rounded text-orange-300">${'${humanTaskDelegate}'}</code>
                            </div>
                            <p className="text-xs text-slate-400">
                                创建人工任务（如审核），流程进入 ReceiveTask 等待人工操作完成后再继续。
                            </p>
                            <div className="bg-slate-900/50 rounded p-3">
                                <div className="text-[10px] text-slate-500 mb-1">BPMN XML 配置示例</div>
                                <pre className="text-[11px] text-slate-300 font-mono whitespace-pre-wrap">{`<serviceTask id="audit_create"
  flowable:delegateExpression="\${humanTaskDelegate}">
  <extensionElements>
    <flowable:field name="humanTaskType"
      stringValue="ticket.audit"/>
  </extensionElements>
</serviceTask>`}</pre>
                            </div>
                        </div>

                        {/* BusinessCallbackDelegate */}
                        <div className="bg-slate-800/30 border border-white/5 rounded-lg p-4 space-y-3">
                            <div className="flex items-center gap-2">
                                <Zap className="w-5 h-5 text-cyan-400" />
                                <h4 className="font-semibold text-white">BusinessCallbackDelegate</h4>
                                <code className="text-xs bg-slate-800 px-2 py-0.5 rounded text-cyan-300">${'${businessCallbackDelegate}'}</code>
                            </div>
                            <p className="text-xs text-slate-400">
                                通过 WorkflowCallbackRegistry 查找已注册的回调，实现 workflow 与 ticket 模块解耦。
                            </p>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                                {[
                                    { type: 'ticket.translationDone', desc: '更新状态为待回复' },
                                    { type: 'ticket.replyDone', desc: '更新状态为待审核' },
                                    { type: 'ticket.auditPass', desc: '标记回复、推送' },
                                    { type: 'ticket.auditReject', desc: '保存驳回意见' },
                                ].map(cb => (
                                    <div key={cb.type} className="p-2 rounded bg-slate-800/50 border border-cyan-500/20">
                                        <div className="text-[11px] font-mono text-cyan-300">{cb.type}</div>
                                        <div className="text-[10px] text-slate-500 mt-0.5">{cb.desc}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </Collapsible>

                {/* ── 4. Agent 接入指南 ── */}
                <Collapsible
                    title="Agent 接入指南"
                    icon={<Bot className="w-5 h-5 text-green-400" />}
                    badge="接入文档"
                >
                    <div className="space-y-4">
                        <p className="text-sm text-slate-300">
                            新 Agent 接入工作流只需 3 步：定义 Agent → 注册 Executor → 在 BPMN 中引用。
                        </p>

                        {/* 接入步骤 */}
                        <div className="space-y-3">
                            {/* Step 1 */}
                            <div className="flex gap-3">
                                <div className="shrink-0 w-8 h-8 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-sm font-bold text-purple-300">
                                    1
                                </div>
                                <div className="flex-1 space-y-2">
                                    <h4 className="text-sm font-semibold text-white">创建 Agent 定义</h4>
                                    <p className="text-xs text-slate-400">
                                        通过管理界面（Agent 管理页面）或 REST API 创建 Agent 定义。需要指定 <code className="text-purple-300">code</code>（唯一标识）、
                                        <code className="text-purple-300">providerType</code>（执行方式）、<code className="text-purple-300">executionEnv</code>（执行环境）。
                                    </p>
                                    <div className="bg-slate-900/50 rounded p-3">
                                        <pre className="text-[11px] text-slate-300 font-mono whitespace-pre-wrap">{`POST /api/v1/agents/definitions
{
  "code": "my-agent",
  "name": "自定义 Agent",
  "providerType": "HTTP_API",
  "executionEnv": "SERVER_ONLY",
  "capability": "custom-task",
  "providerConfig": { "url": "...", "model": "..." },
  "enabled": true
}`}</pre>
                                    </div>
                                </div>
                            </div>

                            {/* Step 2 */}
                            <div className="flex gap-3">
                                <div className="shrink-0 w-8 h-8 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-sm font-bold text-purple-300">
                                    2
                                </div>
                                <div className="flex-1 space-y-2">
                                    <h4 className="text-sm font-semibold text-white">注册前端 Executor（仅 CLIENT_ONLY）</h4>
                                    <p className="text-xs text-slate-400">
                                        如果 Agent 需要在客户端执行（CLIENT_ONLY），需在前端注册 Executor。
                                        SERVER_ONLY Agent 可跳过此步骤。
                                    </p>
                                    <div className="bg-slate-900/50 rounded p-3">
                                        <pre className="text-[11px] text-slate-300 font-mono whitespace-pre-wrap">{`// fd-web/src/shared/agents/executors/MyExecutor.ts
export const myExecutor: AgentExecutor = {
    providerType: 'HTTP_API',
    isAvailable: () => true,
    async execute(definition, input) {
        const result = await fetch(definition.providerConfig.url, {
            method: 'POST',
            body: JSON.stringify({ input: input.input }),
        });
        return { success: true, output: await result.text() };
    },
};

// 在 AgentContext.tsx 中注册
agentRegistry.registerExecutor(myExecutor);`}</pre>
                                    </div>
                                </div>
                            </div>

                            {/* Step 3 */}
                            <div className="flex gap-3">
                                <div className="shrink-0 w-8 h-8 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-sm font-bold text-purple-300">
                                    3
                                </div>
                                <div className="flex-1 space-y-2">
                                    <h4 className="text-sm font-semibold text-white">在 BPMN 流程中添加节点</h4>
                                    <p className="text-xs text-slate-400">
                                        在流程设计器中添加 ServiceTask，使用 <code className="text-purple-300">agentTaskDelegate</code> 并指定 agentCode。
                                        CLIENT_ONLY Agent 还需要添加环境网关和 ReceiveTask。
                                    </p>
                                    <div className="bg-slate-900/50 rounded p-3">
                                        <pre className="text-[11px] text-slate-300 font-mono whitespace-pre-wrap">{`<serviceTask id="my_task"
  flowable:delegateExpression="\${agentTaskDelegate}">
  <extensionElements>
    <flowable:field name="agentCode" stringValue="my-agent"/>
  </extensionElements>
</serviceTask>

<!-- CLIENT_ONLY 时需要追加 -->
<exclusiveGateway id="my_env_gw"/>
<receiveTask id="my_wait" name="等待完成"/>`}</pre>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Provider 类型 */}
                        <div className="mt-4">
                            <h3 className="text-sm font-semibold text-white mb-3">Agent Provider 类型</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <ProviderCard
                                    type="GEMINI_CLI"
                                    icon={<Monitor className="w-5 h-5 text-blue-400" />}
                                    title="GEMINI_CLI"
                                    desc="本地 CLI 工具调用，如 Gemini CLI 翻译（原 LOCAL_CLI）"
                                    env="CLIENT_ONLY"
                                    example="gemini-translate (Gemini CLI)"
                                />
                                <ProviderCard
                                    type="HTTP_API"
                                    icon={<Globe className="w-5 h-5 text-green-400" />}
                                    title="HTTP_API"
                                    desc="HTTP API 调用，支持 OpenAI/Claude 等"
                                    env="SERVER_ONLY / BOTH"
                                    example="OpenAI GPT-4, Claude API"
                                />
                                <ProviderCard
                                    type="WEB_AUTOMATION"
                                    icon={<ExternalLink className="w-5 h-5 text-purple-400" />}
                                    title="WEB_AUTOMATION"
                                    desc="Shadow Window 浏览器自动化操作（原 SHADOW_WINDOW）"
                                    env="CLIENT_ONLY"
                                    example="notebooklm-reply, tracking-query"
                                />
                                <ProviderCard
                                    type="LOCAL_FUNCTION"
                                    icon={<Cpu className="w-5 h-5 text-orange-400" />}
                                    title="LOCAL_FUNCTION"
                                    desc="本地函数调用，自定义逻辑处理"
                                    env="CLIENT_ONLY / BOTH"
                                    example="自定义数据处理函数"
                                />
                            </div>
                        </div>
                    </div>
                </Collapsible>

                {/* ── 5. 异步等待/唤醒机制 ── */}
                <Collapsible
                    title="异步等待/唤醒机制"
                    icon={<Clock className="w-5 h-5 text-yellow-400" />}
                    badge="CLIENT_ONLY"
                >
                    <div className="space-y-4">
                        <p className="text-sm text-slate-300">
                            CLIENT_ONLY Agent（如 Gemini CLI、NotebookLM Shadow Window）需要在桌面客户端本地执行，
                            流程引擎通过 ReceiveTask 暂停等待，WorkflowTaskBridge 在任务完成后自动唤醒。
                        </p>

                        {/* 时序图 */}
                        <div className="bg-slate-800/30 border border-white/5 rounded-lg p-5 space-y-3">
                            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">执行时序</h3>

                            <div className="space-y-2">
                                {[
                                    { step: '1', actor: '引擎', action: 'AgentTaskDelegate 创建 TaskInstance', color: 'purple' },
                                    { step: '2', actor: '引擎', action: 'ReceiveTask 暂停流程 (等待 signal)', color: 'purple' },
                                    { step: '3', actor: 'SSE', action: '推送 task-available 事件到客户端', color: 'cyan' },
                                    { step: '4', actor: '客户端', action: 'REST claim 领取任务', color: 'blue' },
                                    { step: '5', actor: '客户端', action: '执行 Agent (CLI/Shadow/Function)', color: 'blue' },
                                    { step: '6', actor: '客户端', action: 'POST /tasks/{id}/complete 上报结果', color: 'blue' },
                                    { step: '7', actor: '服务端', action: 'TaskDistributionService.completeTask()', color: 'green' },
                                    { step: '8', actor: '桥接器', action: 'WorkflowTaskBridge 解析 payload → signal ReceiveTask', color: 'yellow' },
                                    { step: '9', actor: '引擎', action: 'ReceiveTask 唤醒，流程继续执行', color: 'purple' },
                                    { step: '10', actor: '引擎', action: 'BusinessCallbackDelegate 执行业务回调', color: 'cyan' },
                                ].map(({ step, actor, action, color }) => (
                                    <div key={step} className="flex items-center gap-3">
                                        <span className={`shrink-0 w-6 h-6 rounded-full bg-${color}-500/20 border border-${color}-500/40 flex items-center justify-center text-[10px] font-bold text-${color}-300`}>
                                            {step}
                                        </span>
                                        <span className={`shrink-0 w-16 text-[11px] text-${color}-300 font-medium`}>{actor}</span>
                                        <span className="text-xs text-slate-400">{action}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Payload 结构 */}
                        <div className="bg-slate-800/30 border border-white/5 rounded-lg p-4">
                            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">TaskInstance Payload 结构</h3>
                            <p className="text-xs text-slate-400 mb-2">
                                AgentTaskDelegate 创建 TaskInstance 时，在 payload 中写入流程关联信息，
                                WorkflowTaskBridge 通过此信息定位并唤醒对应的 ReceiveTask。
                            </p>
                            <div className="bg-slate-900/50 rounded p-3">
                                <pre className="text-[11px] text-slate-300 font-mono whitespace-pre-wrap">{`{
  "processInstanceId": "流程实例ID",
  "waitActivityId": "translate_agent_wait",
  "agentCode": "gemini-translate",
  "businessKey": "工单ID (如 123)"
}`}</pre>
                            </div>
                        </div>

                        {/* SSE 混合模式 */}
                        <div className="bg-slate-800/30 border border-white/5 rounded-lg p-4">
                            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">SSE + 轮询混合模式</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                                <div className="p-3 rounded bg-green-500/5 border border-green-500/20">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Zap className="w-4 h-4 text-green-300" />
                                        <span className="text-xs font-semibold text-green-300">SSE 已连接</span>
                                    </div>
                                    <ul className="text-[11px] text-slate-400 space-y-0.5 list-disc list-inside">
                                        <li>SSE 推送触发立即 claim（毫秒级延迟）</li>
                                        <li>30 秒兜底轮询（防止 SSE 丢消息）</li>
                                    </ul>
                                </div>
                                <div className="p-3 rounded bg-yellow-500/5 border border-yellow-500/20">
                                    <div className="flex items-center gap-2 mb-1">
                                        <RefreshCw className="w-4 h-4 text-yellow-300" />
                                        <span className="text-xs font-semibold text-yellow-300">SSE 断开</span>
                                    </div>
                                    <ul className="text-[11px] text-slate-400 space-y-0.5 list-disc list-inside">
                                        <li>自动降级为 3 秒高频轮询</li>
                                        <li>指数退避重连（1s → 2s → 4s → ... → 30s）</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                </Collapsible>

                {/* ── 6. 流程变量参考 ── */}
                <Collapsible
                    title="流程变量参考"
                    icon={<FileVariableIcon />}
                >
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-white/10">
                                    <th className="text-left py-2 px-3 text-slate-400 font-medium">变量名</th>
                                    <th className="text-left py-2 px-3 text-slate-400 font-medium">类型</th>
                                    <th className="text-left py-2 px-3 text-slate-400 font-medium">写入方</th>
                                    <th className="text-left py-2 px-3 text-slate-400 font-medium">说明</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {[
                                    { name: 'pendingTaskType', type: 'String', writer: 'AgentTaskDelegate / HumanTaskDelegate', desc: '当前等待的任务类型，null 表示服务端已执行' },
                                    { name: 'agentInput', type: 'String', writer: '流程启动时', desc: 'Agent 输入数据' },
                                    { name: 'agentSuccess', type: 'Boolean', writer: 'AgentTaskDelegate (SERVER)', desc: 'Agent 执行是否成功' },
                                    { name: 'agentResult', type: 'String', writer: 'AgentTaskDelegate (SERVER)', desc: 'Agent 执行结果' },
                                    { name: 'agentError', type: 'String', writer: 'AgentTaskDelegate (SERVER)', desc: 'Agent 执行错误信息' },
                                    { name: 'auditResult', type: 'String', writer: 'FlowableTicketOrchestrator', desc: '审核结果：PASS / REJECT' },
                                    { name: 'auditRemark', type: 'String', writer: 'FlowableTicketOrchestrator', desc: '审核意见' },
                                    { name: 'replyId', type: 'Long', writer: 'FlowableTicketOrchestrator', desc: '回复 ID' },
                                    { name: 'auditorId', type: 'Long', writer: 'FlowableTicketOrchestrator', desc: '审核员 ID' },
                                ].map(v => (
                                    <tr key={v.name} className="hover:bg-white/5">
                                        <td className="py-2 px-3 font-mono text-purple-300">{v.name}</td>
                                        <td className="py-2 px-3 text-slate-400">{v.type}</td>
                                        <td className="py-2 px-3 text-slate-400">{v.writer}</td>
                                        <td className="py-2 px-3 text-slate-400">{v.desc}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Collapsible>

                {/* ── 7. API 参考 ── */}
                <Collapsible
                    title="REST API 参考"
                    icon={<Globe className="w-5 h-5 text-indigo-400" />}
                >
                    <div className="space-y-4">
                        <div>
                            <h4 className="text-sm font-semibold text-white mb-2">流程定义管理</h4>
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="border-b border-white/10">
                                            <th className="text-left py-2 px-3 text-slate-400">方法</th>
                                            <th className="text-left py-2 px-3 text-slate-400">端点</th>
                                            <th className="text-left py-2 px-3 text-slate-400">权限</th>
                                            <th className="text-left py-2 px-3 text-slate-400">说明</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {[
                                            { method: 'GET', path: '/workflows/definitions', perm: 'workflow:manage', desc: '获取所有流程定义' },
                                            { method: 'POST', path: '/workflows/definitions', perm: 'workflow:manage', desc: '创建流程定义' },
                                            { method: 'PUT', path: '/workflows/definitions/{id}', perm: 'workflow:manage', desc: '更新流程定义' },
                                            { method: 'DELETE', path: '/workflows/definitions/{id}', perm: 'workflow:manage', desc: '删除流程定义' },
                                            { method: 'GET', path: '/workflows/definitions/{id}/bpmn', perm: 'workflow:design', desc: '获取 BPMN XML' },
                                            { method: 'PUT', path: '/workflows/definitions/{id}/bpmn', perm: 'workflow:design', desc: '保存 BPMN XML' },
                                            { method: 'POST', path: '/workflows/definitions/{id}/deploy', perm: 'workflow:deploy', desc: '部署到引擎' },
                                        ].map((api, i) => (
                                            <tr key={i} className="hover:bg-white/5">
                                                <td className="py-2 px-3">
                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                                        api.method === 'GET' ? 'bg-blue-500/20 text-blue-300' :
                                                        api.method === 'POST' ? 'bg-green-500/20 text-green-300' :
                                                        api.method === 'PUT' ? 'bg-yellow-500/20 text-yellow-300' :
                                                        'bg-red-500/20 text-red-300'
                                                    }`}>{api.method}</span>
                                                </td>
                                                <td className="py-2 px-3 font-mono text-slate-300">/api/v1{api.path}</td>
                                                <td className="py-2 px-3 text-slate-400">{api.perm}</td>
                                                <td className="py-2 px-3 text-slate-400">{api.desc}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div>
                            <h4 className="text-sm font-semibold text-white mb-2">流程实例管理</h4>
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="border-b border-white/10">
                                            <th className="text-left py-2 px-3 text-slate-400">方法</th>
                                            <th className="text-left py-2 px-3 text-slate-400">端点</th>
                                            <th className="text-left py-2 px-3 text-slate-400">说明</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {[
                                            { method: 'GET', path: '/workflows/instances/{id}/activities', desc: '获取活跃节点' },
                                            { method: 'POST', path: '/workflows/instances/{id}/signal', desc: '唤醒 ReceiveTask' },
                                            { method: 'DELETE', path: '/workflows/instances/{id}', desc: '终止流程' },
                                        ].map((api, i) => (
                                            <tr key={i} className="hover:bg-white/5">
                                                <td className="py-2 px-3">
                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                                        api.method === 'GET' ? 'bg-blue-500/20 text-blue-300' :
                                                        api.method === 'POST' ? 'bg-green-500/20 text-green-300' :
                                                        'bg-red-500/20 text-red-300'
                                                    }`}>{api.method}</span>
                                                </td>
                                                <td className="py-2 px-3 font-mono text-slate-300">/api/v1{api.path}</td>
                                                <td className="py-2 px-3 text-slate-400">{api.desc}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </Collapsible>

                {/* Footer */}
                <div className="text-center text-xs text-slate-600 py-4">
                    Flowable BPMN 2.0 + SSE Real-time Push + Agent Runtime
                </div>
            </div>
        </div>
    );
};

/* 简易变量图标 */
function FileVariableIcon() {
    return (
        <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
    );
}

export default WorkflowGuideTab;
