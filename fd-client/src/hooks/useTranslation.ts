import { useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { Ticket } from '../types';

export function useTranslation(
  outputDir: string,
  tickets: Ticket[],
  selectedTicket: Ticket | null,
  setSelectedTicket: (t: Ticket | null) => void,
  setDisplayLang: (l: 'original' | 'cn' | 'en') => void,
  setIsLoadingTickets: (b: boolean) => void,
  loadTickets: () => void,
  setLogs: (updater: (prev: string[]) => string[]) => void
) {
  const [isTranslating, setIsTranslating] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [isAborting, setIsAborting] = useState(false);
  const abortBatchRef = useRef(false);

  // Single translation
  async function handleTranslate(targetLang: 'cn' | 'en', force = false) {
    if (!selectedTicket || !outputDir) return;
    setIsTranslating(true);
    setDisplayLang(targetLang);
    try {
      if (!force) {
        const existing = await invoke<Ticket | null>("load_ticket_cmd", {
          outputDir,
          ticketId: selectedTicket.id,
          lang: targetLang
        });

        if (existing) {
          setSelectedTicket(existing);
          setIsTranslating(false);
          return;
        }
      }

      const translated = await invoke<Ticket>("translate_ticket_cmd", {
        outputDir,
        ticketId: selectedTicket.id,
        targetLang
      });

      const updatedLangs = [...(selectedTicket.available_langs || []), targetLang];
      const deduplicated = Array.from(new Set(updatedLangs));
      setSelectedTicket({ ...translated, available_langs: deduplicated });
    } catch (error) {
      console.error("Translation error:", error);
      alert("Translation failed: " + error);
    }
    setIsTranslating(false);
  }

  // Batch translation
  async function handleBatchTranslate(langs: ('cn' | 'en')[]) {
    if (selectedIds.size === 0 || !outputDir) return;
    const ids = Array.from(selectedIds);
    
    setIsLoadingTickets(true);
    abortBatchRef.current = false;
    setIsAborting(false);
    const totalSteps = ids.length * langs.length;
    let currentStep = 0;
    setBatchProgress({ current: 0, total: totalSteps });

    try {
      for (const id of ids) {
        if (abortBatchRef.current) break;
        const ticket = tickets.find(t => String(t.id) === String(id));

        for (const targetLang of langs) {
          if (abortBatchRef.current) break;
          currentStep++;
          setBatchProgress({ current: currentStep, total: totalSteps });

          if (ticket?.available_langs?.includes(targetLang)) continue;

          let retryCount = 0;
          let success = false;
          while (retryCount < 5 && !success && !abortBatchRef.current) {
            try {
              const translated = await invoke<Ticket>("translate_ticket_cmd", {
                outputDir,
                ticketId: Number(id),
                targetLang
              });

              if (selectedTicket?.id === Number(id)) {
                const updatedLangs = [...(selectedTicket.available_langs || []), targetLang];
                const deduplicated = Array.from(new Set(updatedLangs));
                setSelectedTicket({ ...translated, available_langs: deduplicated });
                setDisplayLang(targetLang);
              }
              success = true;
            } catch (err) {
              retryCount++;
              if (retryCount >= 5) {
                setLogs(prev => [...prev, `❌ [Batch] Ticket #${id} failed after 5 retries. Aborting.`]);
                abortBatchRef.current = true;
              } else {
                setLogs(prev => [...prev, `⚠️ [Batch] Ticket #${id} attempt ${retryCount} failed. Retrying...`]);
                await new Promise(r => setTimeout(r, 1000));
              }
            }
          }
        }
      }

      if (abortBatchRef.current) {
        setLogs(prev => [...prev, "🛑 Batch translation stopped."]);
      } else {
        setLogs(prev => [...prev, "✅ Batch translation flow completed."]);
      }

      await loadTickets();
      setSelectedIds(new Set());
    } catch (error) {
      console.error("[Batch] Error:", error);
      alert("Batch translation failed: " + error);
    } finally {
      setIsLoadingTickets(false);
      setBatchProgress(null);
      setIsAborting(false);
      abortBatchRef.current = false;
    }
  }

  // Batch export
  async function handleBatchExport(listLang: string) {
    if (selectedIds.size === 0 || !outputDir) return;

    try {
      const filePath = await save({
        filters: [{ name: 'CSV', extensions: ['csv'] }],
        defaultPath: 'tickets_export.csv'
      });
      if (!filePath) return;

      setIsLoadingTickets(true);
      setLogs(prev => [...prev, `📊 Exporting ${selectedIds.size} tickets to CSV...`]);

      await invoke("export_to_csv_cmd", {
        outputDir,
        ticketIds: Array.from(selectedIds),
        lang: listLang === 'original' ? null : listLang,
        savePath: filePath
      });

      setLogs(prev => [...prev, `✅ Export complete: ${filePath}`]);
      setSelectedIds(new Set());
    } catch (error) {
      console.error("[Export] Error:", error);
      alert("Export failed: " + error);
    } finally {
      setIsLoadingTickets(false);
    }
  }

  const toggleTicketSelection = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  async function handleSwitchToOriginal() {
    if (!selectedTicket || !outputDir) return;
    try {
      const original = await invoke<Ticket | null>("load_ticket_cmd", {
        outputDir,
        ticketId: selectedTicket.id,
        lang: null
      });
      if (original) {
        setSelectedTicket(original);
        setDisplayLang('original');
      }
    } catch (error) {
      console.error(error);
    }
  }

  return {
    isTranslating,
    selectedIds, setSelectedIds,
    batchProgress,
    isAborting, setIsAborting,
    abortBatchRef,
    handleTranslate,
    handleBatchTranslate,
    handleBatchExport,
    toggleTicketSelection,
    handleSwitchToOriginal
  };
}
