import React from 'react';
import { useTranslation } from 'react-i18next';
import { useMQTranslation } from '../../../shared/context/MQTranslationContext';
import MQConsumerTaskTab from '../components/MQConsumerTaskTab';

interface TranslationTasksTabProps {
    initialSelectedId?: number | null;
    onNavigated?: () => void;
}

const TranslationTasksTab: React.FC<TranslationTasksTabProps> = ({ initialSelectedId, onNavigated }) => {
    const { t } = useTranslation(['tasks', 'common']);
    const {
        processingTasks, completedHistory, isRunning,
        startConsumer, stopConsumer, logs
    } = useMQTranslation();

    return (
        <MQConsumerTaskTab
            processingTasks={processingTasks}
            completedHistory={completedHistory}
            isRunning={isRunning}
            startConsumer={startConsumer}
            stopConsumer={stopConsumer}
            logs={logs}
            color="cyan"
            title={t('translation.title')}
            workspaceType="translation"
            labels={{
                statusRunning: t('translation.statusRunning'),
                statusStopped: t('translation.statusStopped'),
                startConsumer: t('translation.startConsumer'),
                stopConsumer: t('translation.stopConsumer'),
                processing: t('translation.processing'),
                completedHistory: t('translation.completedHistory'),
                idle: t('translation.idle'),
                noCompleted: t('translation.noCompleted'),
                statusDone: t('translation.statusDone'),
                statusFailed: t('translation.statusFailed'),
                statusSkipped: t('translation.statusSkipped'),
            }}
            initialSelectedId={initialSelectedId}
            onNavigated={onNavigated}
        />
    );
};

export default TranslationTasksTab;
