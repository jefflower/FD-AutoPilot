import React, { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { serverApi } from '../../services/serverApi';
import { useAiReply } from '../../hooks/useAiReply';

interface MqReplyRunnerProps {
    mqTarget: { id: number; type: 'translate' | 'reply' } | null;
    onMqTargetHandled: () => void;
}

const MqReplyRunner: React.FC<MqReplyRunnerProps> = ({ mqTarget, onMqTargetHandled }) => {
    const { runReply } = useAiReply();

    useEffect(() => {
        if (!mqTarget || mqTarget.type !== 'reply') return;

        console.log(`[MqReplyRunner] 🚀 Picked up task for ticket #${mqTarget.id}`);

        const processTask = async () => {
            try {
                // 1. Fetch fresh ticket data explicitly
                console.log(`[MqReplyRunner] Fetching details for ticket #${mqTarget.id}...`);
                const ticket = await serverApi.ticket.getTicketDetail(mqTarget.id);

                if (!ticket) {
                    throw new Error(`Ticket #${mqTarget.id} not found`);
                }

                // 2. Run Reply with autoSave=true
                console.log(`[MqReplyRunner] Running AI reply generation...`);
                // Note: runReply will check for notebookConfig, etc.
                const success = await runReply(ticket, {
                    autoSave: true, // IMPORTANT
                    onStatusChange: (status) => console.log(`[MqReplyRunner] Status: ${status}`),
                    onError: (err) => console.error(`[MqReplyRunner] Error: ${err}`)
                });

                // 3. Notify Rust (success only if true)
                console.log(`[MqReplyRunner] Task completed, success: ${success}`);
                await invoke('complete_reply_task', {
                    ticketId: mqTarget.id,
                    success: success === true
                });

            } catch (err) {
                console.error(`[MqReplyRunner] Failed to process ticket #${mqTarget.id}:`, err);
                // Notify Rust of failure
                await invoke('complete_reply_task', {
                    ticketId: mqTarget.id,
                    success: false
                });
            } finally {
                // 4. Release task
                onMqTargetHandled();
            }
        };

        processTask();

    }, [mqTarget, onMqTargetHandled, runReply]);

    return null; // Headless
};

export default MqReplyRunner;
