import React from 'react';

type ThemeColor = 'cyan' | 'orange' | 'pink';

interface ConsumerControlButtonsProps {
    isRunning: boolean;
    onStart: () => void;
    onStop: () => void;
    startLabel: string;
    stopLabel: string;
    color: ThemeColor;
}

const COLOR_STYLES: Record<ThemeColor, string> = {
    cyan: 'bg-cyan-600 hover:bg-cyan-500 shadow-lg shadow-cyan-900/20',
    orange: 'bg-orange-600 hover:bg-orange-500 shadow-lg shadow-orange-900/20',
    pink: 'bg-pink-600 hover:bg-pink-500 shadow-lg shadow-pink-900/20',
};

const ConsumerControlButtons: React.FC<ConsumerControlButtonsProps> = ({
    isRunning, onStart, onStop, startLabel, stopLabel, color
}) => (
    <div className="flex gap-2">
        {!isRunning ? (
            <button
                onClick={onStart}
                className={`flex-1 h-9 ${COLOR_STYLES[color]} text-white text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2`}
            >
                {startLabel}
            </button>
        ) : (
            <button
                onClick={onStop}
                className="flex-1 h-9 bg-red-500/80 hover:bg-red-500 text-white text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2"
            >
                {stopLabel}
            </button>
        )}
    </div>
);

export default ConsumerControlButtons;
