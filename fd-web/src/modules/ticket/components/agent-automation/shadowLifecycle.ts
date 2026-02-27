import { isTauriEnv, tauriInvoke } from '../../../../tauri/bridge';
import { parseProviderConfig } from '../../../../shared/agents/schemaUtils';
import type { AgentDefinition } from '../../../../shared/types/server';
import type { ShadowStatus } from './types';

/** Agent 启动时初始化 Shadow Window */
export async function initAgentShadow(definition: AgentDefinition): Promise<void> {
    if (!isTauriEnv() || definition.providerType !== 'NOTEBOOKLM') return;
    const config = parseProviderConfig(definition.providerConfig);

    if (definition.capability === 'reply' && config.windowLabel === 'notebook_shadow') {
        await tauriInvoke('open_notebook_window', {
            notebookId: config.notebookId || '',
            notebookUrl: config.notebookUrl || '',
        });
        return;
    }

    // tracking: 由 TrackingShadowService 按需管理，不预打开
    if (definition.capability === 'tracking') return;

    if (config.windowLabel) {
        await tauriInvoke('open_shadow_window', {
            label: config.windowLabel,
            url: config.windowUrl || '',
        });
    }
}

/** Agent 停止时关闭 Shadow Window */
export async function closeAgentShadow(definition: AgentDefinition): Promise<void> {
    if (!isTauriEnv() || definition.providerType !== 'NOTEBOOKLM') return;

    if (definition.capability === 'reply') {
        await tauriInvoke('toggle_notebook_window', { visible: false }).catch(() => {});
    }
}

/** 查询 Shadow Window 状态 */
export async function getShadowStatus(definition: AgentDefinition): Promise<ShadowStatus> {
    if (!isTauriEnv() || definition.providerType !== 'NOTEBOOKLM') return 'n/a';

    if (definition.capability === 'reply') {
        try {
            const visible = await tauriInvoke('get_notebook_window_visibility', {});
            return visible ? 'ready' : 'closed';
        } catch {
            return 'closed';
        }
    }
    return 'n/a';
}
