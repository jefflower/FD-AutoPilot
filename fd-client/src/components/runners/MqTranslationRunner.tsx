import React, { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { serverApi } from '../../services/serverApi';
import { useAiTranslation } from '../../hooks/useAiTranslation';

interface MqTranslationRunnerProps {
    mqTarget: { id: number; type: 'translate' | 'reply' } | null;
    onMqTargetHandled: () => void;
}

const MqTranslationRunner: React.FC<MqTranslationRunnerProps> = ({ mqTarget, onMqTargetHandled }) => {
    const { runTranslation } = useAiTranslation();

    useEffect(() => {
        if (!mqTarget || mqTarget.type !== 'translate') return;

        console.log(`[MqTranslationRunner] 🚀 Picked up task for ticket #${mqTarget.id}`);

        const processTask = async () => {
            try {
                // 1. Fetch fresh ticket data explicitly
                // WE DO NOT RELY ON UI STATE HERE. Always fetch fresh data.
                console.log(`[MqTranslationRunner] Fetching details for ticket #${mqTarget.id}...`);
                const ticket = await serverApi.ticket.getTicketDetail(mqTarget.id);

                if (!ticket) {
                    throw new Error(`Ticket #${mqTarget.id} not found`);
                }

                // 2. Run Translation with autoSave=true
                console.log(`[MqTranslationRunner] Running translation...`);
                const success = await runTranslation(ticket, {
                    autoSave: true,
                    onStatusChange: (status) => console.log(`[MqTranslationRunner] Status: ${status}`),
                    onError: (err) => console.error(`[MqTranslationRunner] Error: ${err}`)
                });

                // 3. Notify Rust
                console.log(`[MqTranslationRunner] Task completed, success: ${success}`);
                await invoke('complete_translate_task', {
                    ticketId: mqTarget.id,
                    success: success === true
                });

            } catch (err) {
                console.error(`[MqTranslationRunner] Failed to process ticket #${mqTarget.id}:`, err);
                // Notify Rust of failure
                await invoke('complete_translate_task', {
                    ticketId: mqTarget.id,
                    success: false
                });
            } finally {
                // 4. Release task
                onMqTargetHandled();
            }
        };

        processTask();

    }, [mqTarget, onMqTargetHandled, runTranslation]);

    return null; // Headless component
};

export default MqTranslationRunner;
