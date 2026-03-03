import React from 'react';
import { FileText, Globe, FileCode, Sheet } from 'lucide-react';
import type { KnowledgeSourceType } from '../../../shared/types/server';

interface SourceTypeIconProps {
    type: KnowledgeSourceType;
    size?: number;
    className?: string;
}

const TYPE_CONFIG: Record<KnowledgeSourceType, { icon: React.ElementType; color: string }> = {
    PDF: { icon: FileText, color: 'text-red-400' },
    URL: { icon: Globe, color: 'text-blue-400' },
    TEXT: { icon: FileText, color: 'text-slate-400' },
    CSV: { icon: Sheet, color: 'text-green-400' },
    MARKDOWN: { icon: FileCode, color: 'text-purple-400' },
};

const SourceTypeIcon: React.FC<SourceTypeIconProps> = ({ type, size = 14, className = '' }) => {
    const config = TYPE_CONFIG[type] || TYPE_CONFIG.TEXT;
    const Icon = config.icon;
    return <Icon size={size} className={`${config.color} ${className}`} />;
};

export default SourceTypeIcon;
