import React from 'react';

interface EmptyStateHintProps {
    message: string;
}

const EmptyStateHint: React.FC<EmptyStateHintProps> = ({ message }) => (
    <div className="text-center py-6 text-slate-600 text-[10px] italic border border-dashed border-white/5 rounded-xl">
        {message}
    </div>
);

export default EmptyStateHint;
