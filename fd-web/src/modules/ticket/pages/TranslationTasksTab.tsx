import React, { useState, useEffect, useRef } from 'react';
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
        startConsumer, stopConsumer, batchSize, updateBatchSize, logs
    } = useMQTranslation();

    // 并发数控制
    const [localBatchSize, setLocalBatchSize] = useState<string>('5');
    const [isInputFocused, setIsInputFocused] = useState(false);
    const batchSizeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!isInputFocused) {
            setLocalBatchSize(batchSize.toString());
        }
    }, [batchSize, isInputFocused]);

    const handleBatchSizeChange = (value: string) => {
        setLocalBatchSize(value);
        if (batchSizeDebounceRef.current) clearTimeout(batchSizeDebounceRef.current);
        batchSizeDebounceRef.current = setTimeout(() => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num > 0 && num <= 100) {
                updateBatchSize(num);
            }
        }, 500);
    };

    const batchSizeControl = (
        <div className="flex items-center justify-between px-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('translation.concurrency')}</span>
            <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500">x</span>
                <input
                    type="number"
                    min={1}
                    max={100}
                    value={localBatchSize}
                    onFocus={() => setIsInputFocused(true)}
                    onBlur={() => setIsInputFocused(false)}
                    onChange={(e) => handleBatchSizeChange(e.target.value)}
                    className="w-10 h-6 bg-black/40 border border-white/5 rounded text-cyan-400 text-xs text-center font-mono focus:outline-none focus:border-cyan-500/50"
                />
            </div>
        </div>
    );

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
            headerExtra={batchSizeControl}
            initialSelectedId={initialSelectedId}
            onNavigated={onNavigated}
        />
    );
};

export default TranslationTasksTab;
