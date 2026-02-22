import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { useTranslation } from 'react-i18next';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';

export interface BpmnEditorHandle {
    getXml: () => Promise<string>;
}

interface BpmnEditorProps {
    xml: string;
    onChanged?: () => void;
}

const EMPTY_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
             xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
             id="Definitions_1"
             targetNamespace="http://bpmn.io/schema/bpmn">
  <process id="Process_1" isExecutable="true">
    <startEvent id="StartEvent_1"/>
  </process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="_BPMNShape_StartEvent_1" bpmnElement="StartEvent_1">
        <dc:Bounds x="180" y="160" width="36" height="36"/>
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>`;

const BpmnEditor = forwardRef<BpmnEditorHandle, BpmnEditorProps>(({ xml, onChanged }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const modelerRef = useRef<BpmnModeler | null>(null);
    const { i18n } = useTranslation('bpmn');

    const getXml = useCallback(async (): Promise<string> => {
        if (!modelerRef.current) return '';
        const result = await (modelerRef.current as any).saveXML({ format: true });
        return result.xml || '';
    }, []);

    useImperativeHandle(ref, () => ({ getXml }), [getXml]);

    // 初始化 modeler（语言切换时重建以刷新 UI 文案）
    useEffect(() => {
        if (!containerRef.current) return;

        // 基于当前 i18next 语言构建翻译函数
        const bpmnTranslations: Record<string, string> = (i18n.getResourceBundle(i18n.language, 'bpmn') as Record<string, string>) || {};

        function customTranslate(template: string, replacements?: Record<string, string>): string {
            let result = bpmnTranslations[template] || template;
            if (replacements) {
                for (const [key, value] of Object.entries(replacements)) {
                    result = result.replace(`{${key}}`, value);
                }
            }
            return result;
        }

        const translateModule = {
            translate: ['value', customTranslate],
        };

        const modeler = new BpmnModeler({
            container: containerRef.current,
            keyboard: { bindTo: document },
            additionalModules: [translateModule],
        });

        modelerRef.current = modeler;

        if (onChanged) {
            modeler.on('commandStack.changed', onChanged);
        }

        // 加载当前 XML
        const xmlToLoad = xml?.trim() ? xml : EMPTY_BPMN;
        (async () => {
            try {
                await modeler.importXML(xmlToLoad);
                const canvas = modeler.get('canvas') as any;
                canvas.zoom('fit-viewport');
            } catch (err) {
                console.error('[BpmnEditor] Failed to import XML:', err);
            }
        })();

        return () => {
            modeler.destroy();
            modelerRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [i18n.language]);

    // XML 变更时重新导入（语言未变的情况下）
    useEffect(() => {
        const modeler = modelerRef.current;
        if (!modeler) return;

        const xmlToLoad = xml?.trim() ? xml : EMPTY_BPMN;

        (async () => {
            try {
                await modeler.importXML(xmlToLoad);
                const canvas = modeler.get('canvas') as any;
                canvas.zoom('fit-viewport');
            } catch (err) {
                console.error('[BpmnEditor] Failed to import XML:', err);
            }
        })();
    }, [xml]);

    return (
        <div
            ref={containerRef}
            className="w-full h-full bg-white"
            style={{ minHeight: 400 }}
        />
    );
});

BpmnEditor.displayName = 'BpmnEditor';

export default BpmnEditor;
