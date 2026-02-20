import React from 'react';
import { useTranslation } from 'react-i18next';
import { useMQReply } from '../../../shared/context/MQReplyContext';
import MQConsumerTaskTab from '../components/MQConsumerTaskTab';

interface ReplyTasksTabProps {
    initialSelectedId?: number | null;
    onNavigated?: () => void;
}

const ReplyTasksTab: React.FC<ReplyTasksTabProps> = ({ initialSelectedId, onNavigated }) => {
    const { t } = useTranslation(['tasks', 'common']);
    const {
        processingTasks, completedHistory, isRunning,
        startConsumer, stopConsumer, logs
    } = useMQReply();

    return (
        <MQConsumerTaskTab
            processingTasks={processingTasks}
            completedHistory={completedHistory}
            isRunning={isRunning}
            startConsumer={startConsumer}
            stopConsumer={stopConsumer}
            logs={logs}
            color="orange"
            title={t('reply.title')}
            workspaceType="reply"
            labels={{
                statusRunning: t('reply.statusRunning'),
                statusStopped: t('reply.statusStopped'),
                startConsumer: t('reply.startConsumer'),
                stopConsumer: t('reply.stopConsumer'),
                processing: t('reply.processing'),
                completedHistory: t('reply.completed'),
                idle: t('reply.idle'),
                noCompleted: t('reply.noCompleted'),
                statusDone: t('reply.statusDone'),
                statusFailed: t('reply.statusFailed'),
                statusSkipped: t('reply.statusSkipped'),
            }}
            initialSelectedId={initialSelectedId}
            onNavigated={onNavigated}
        />
    );
};

export default ReplyTasksTab;
