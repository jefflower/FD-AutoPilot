/**
 * System Prompt 模板库
 *
 * 提供预设的提示词模板，帮助用户快速选择常见场景的 Agent 提示词。
 */

export interface PromptTemplate {
    id: string;
    name: string;
    nameEn: string;
    category: 'translation' | 'reply' | 'summary' | 'classification';
    prompt: string;
    description: string;
    descriptionEn: string;
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
    {
        id: 'translate-support',
        name: '客服工单翻译',
        nameEn: 'Support Ticket Translation',
        category: 'translation',
        prompt: 'You are a professional customer support translator. Translate the following support ticket content accurately while maintaining the original meaning and tone. Output format: JSON with subject, description_text, and conversations fields.',
        description: '将客服工单翻译成目标语言，保持原始含义和语气',
        descriptionEn: 'Translate support tickets while preserving meaning and tone',
    },
    {
        id: 'translate-formal',
        name: '正式文档翻译',
        nameEn: 'Formal Document Translation',
        category: 'translation',
        prompt: 'You are a professional translator specialized in formal business communications. Translate the following content with formal tone and precise terminology.',
        description: '适用于正式商务文档的翻译',
        descriptionEn: 'For formal business document translation',
    },
    {
        id: 'reply-support',
        name: '客服回复',
        nameEn: 'Support Reply',
        category: 'reply',
        prompt: '请使用用户工单的语言，根据下面的工单内容（可能包含已经回复过的内容）简要的做出回复，直接给出回复内容即可。回复应该专业、友好，解决用户的问题。',
        description: '根据工单上下文生成专业友好的客服回复',
        descriptionEn: 'Generate professional support replies based on ticket context',
    },
    {
        id: 'reply-technical',
        name: '技术支持回复',
        nameEn: 'Technical Support Reply',
        category: 'reply',
        prompt: '你是一名技术支持工程师。根据下面的工单内容，提供详细的技术解决方案。使用用户工单的语言回复，包含清晰的步骤说明。',
        description: '适用于技术问题的详细解决方案回复',
        descriptionEn: 'Detailed technical solutions for support issues',
    },
    {
        id: 'summary-ticket',
        name: '工单摘要',
        nameEn: 'Ticket Summary',
        category: 'summary',
        prompt: 'Summarize the following support ticket conversation in 2-3 sentences. Include the main issue, current status, and any pending actions.',
        description: '快速生成工单对话摘要',
        descriptionEn: 'Quick summary of ticket conversations',
    },
    {
        id: 'classify-ticket',
        name: '工单分类',
        nameEn: 'Ticket Classification',
        category: 'classification',
        prompt: 'Classify the following support ticket into one of these categories: billing, shipping, product-quality, technical-support, returns, general-inquiry. Return JSON: {"category": "...", "confidence": 0.0-1.0, "reason": "..."}',
        description: '自动将工单归类到预定义类别',
        descriptionEn: 'Automatically classify tickets into categories',
    },
];

export const TEMPLATE_CATEGORIES = {
    translation: { label: '翻译', labelEn: 'Translation', color: 'bg-blue-500/20 text-blue-400' },
    reply: { label: '回复', labelEn: 'Reply', color: 'bg-green-500/20 text-green-400' },
    summary: { label: '摘要', labelEn: 'Summary', color: 'bg-purple-500/20 text-purple-400' },
    classification: { label: '分类', labelEn: 'Classification', color: 'bg-amber-500/20 text-amber-400' },
} as const;
