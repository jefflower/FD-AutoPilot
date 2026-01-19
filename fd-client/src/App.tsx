import { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import "./index.css";

interface Ticket {
  id: number;
  subject: string;
  description_text: string | null;
  status: number;
  priority: number;
  created_at: string;
  updated_at: string;
  conversations?: Conversation[];
  available_langs?: string[];
}

interface Conversation {
  id: number;
  body_text: string;
  created_at: string;
  incoming: boolean;
  private: boolean;
}

interface Settings {
  api_key: string;
  output_dir: string;
  sync_start_date: string;
}

interface Progress {
  phase: string;
  current: number;
  total: number;
  ticketId?: number;
  processed?: number;
  totalTickets?: number;
}

function App() {
  const [apiKey, setApiKey] = useState("");
  const [outputDir, setOutputDir] = useState("data");
  const [syncStartDate, setSyncStartDate] = useState("2025-01");
  const [logs, setLogs] = useState<string[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [activeTab, setActiveTab] = useState<'sync' | 'browse' | 'settings'>('sync');
  const [fullSync, setFullSync] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [statusFilter, setStatusFilter] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [listLang, setListLang] = useState<'original' | 'cn' | 'en'>('original');
  const [displayLang, setDisplayLang] = useState<'original' | 'cn' | 'en'>('original');
  const [isTranslating, setIsTranslating] = useState(false);
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const abortBatchRef = useRef(false);
  const [isAborting, setIsAborting] = useState(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    invoke<Settings>("load_settings_cmd").then((settings) => {
      if (settings.api_key) setApiKey(settings.api_key);
      if (settings.output_dir) setOutputDir(settings.output_dir);
      if (settings.sync_start_date) setSyncStartDate(settings.sync_start_date);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (apiKey || outputDir !== "data" || syncStartDate !== "2025-01") {
        invoke("save_settings_cmd", { apiKey, outputDir, syncStartDate }).catch(console.error);
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [apiKey, outputDir, syncStartDate]);

  useEffect(() => {
    const unlistenLog = listen<string>("log", (event) => {
      setLogs((prev) => [...prev, event.payload]);
    });
    const unlistenProgress = listen<Progress>("progress", (event) => {
      setProgress(event.payload);
    });
    return () => {
      unlistenLog.then((f) => f());
      unlistenProgress.then((f) => f());
    };
  }, []);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  async function selectFolder() {
    try {
      const folder = await open({ directory: true, multiple: false, title: "Select Output Directory" });
      if (folder) setOutputDir(folder as string);
    } catch (error) {
      console.error(error);
    }
  }

  async function startSync() {
    if (!apiKey) {
      setLogs(["❌ Error: API Key is required. Please configure in Settings."]);
      return;
    }
    setIsSyncing(true);
    setLogs([]);
    setProgress({ phase: "starting", current: 0, total: 100 });
    try {
      const msg = await invoke("sync_tickets", { apiKey, outputDir, fullSync, syncStartDate });
      setLogs((prev) => [...prev, `✅ ${msg}`]);
      loadTickets();
    } catch (error) {
      setLogs((prev) => [...prev, `❌ Error: ${error}`]);
    }
    setIsSyncing(false);
    setProgress(null);
  }

  async function loadTickets() {
    setIsLoadingTickets(true);
    try {
      const list = await invoke<Ticket[]>("list_local_tickets", {
        outputDir,
        lang: listLang === 'original' ? null : listLang
      });
      setTickets(list);
    } catch (error) {
      console.error(error);
    }
    setIsLoadingTickets(false);
  }

  useEffect(() => { loadTickets(); }, [outputDir, listLang]);

  const getStatusBadge = (status: number) => {
    const statusMap: Record<number, { label: string; color: string }> = {
      2: { label: 'Open', color: 'bg-green-500' },
      3: { label: 'Pending', color: 'bg-yellow-500' },
      4: { label: 'Resolved', color: 'bg-blue-500' },
      5: { label: 'Closed', color: 'bg-gray-500' },
    };
    const s = statusMap[status] || { label: 'Unknown', color: 'bg-gray-400' };
    return <span className={`px-2 py-1 text-xs font-medium rounded-full ${s.color} text-white`}>{s.label}</span>;
  };

  const getLangLabel = (lang: string) => {
    const labels: Record<string, { label: string; color: string }> = {
      'cn': { label: 'ZH', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
      'en': { label: 'EN', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
    };
    const l = labels[lang] || { label: lang.toUpperCase(), color: 'bg-slate-500/20 text-slate-400 border-slate-500/30' };
    return (
      <span key={lang} className={`px-1.5 py-0.5 text-[9px] font-bold rounded border ${l.color}`}>
        {l.label}
      </span>
    );
  };

  // Handle batch translation
  async function handleBatchTranslate(langs: ('cn' | 'en')[]) {
    if (selectedIds.size === 0 || !outputDir) return;
    const ids = Array.from(selectedIds);
    console.log(`[Batch] Starting for ${ids.length} tickets, langs:`, langs);

    setIsLoadingTickets(true);
    abortBatchRef.current = false;
    setIsAborting(false);
    const totalSteps = ids.length * langs.length;
    let currentStep = 0;
    setBatchProgress({ current: 0, total: totalSteps });

    try {
      for (const id of ids) {
        if (abortBatchRef.current) break;
        // Find the ticket to check for existing translations
        // Using String comparison to avoid any number/string mismatch issues
        const ticket = tickets.find(t => String(t.id) === String(id));
        console.log(`[Batch] Processing ticket #${id}, found in state:`, !!ticket);

        for (const targetLang of langs) {
          if (abortBatchRef.current) break;
          currentStep++;
          setBatchProgress({ current: currentStep, total: totalSteps });

          // Skip if translation already exists
          if (ticket?.available_langs?.includes(targetLang)) {
            console.log(`[Batch] Skipping ticket #${id} for lang ${targetLang} (already exists)`);
            continue;
          }

          let retryCount = 0;
          let success = false;
          while (retryCount < 5 && !success && !abortBatchRef.current) {
            try {
              console.log(`[Batch] Translating ticket #${id} to ${targetLang} (Attempt ${retryCount + 1})...`);
              // Trigger AI translation via command
              const translated = await invoke<Ticket>("translate_ticket_cmd", {
                outputDir,
                ticketId: Number(id),
                targetLang
              });

              // If the current ticket is being translated in batch, update the view
              if (selectedTicket?.id === Number(id)) {
                const updatedLangs = [...(selectedTicket.available_langs || []), targetLang];
                const deduplicated = Array.from(new Set(updatedLangs));
                setSelectedTicket({ ...translated, available_langs: deduplicated });
                setDisplayLang(targetLang);
              }
              success = true;
            } catch (itemError) {
              retryCount++;
              console.error(`[Batch] Error translating ticket #${id} (Attempt ${retryCount}):`, itemError);
              if (retryCount >= 5) {
                console.error(`[Batch] Maximum retries reached for ticket #${id}. Aborting batch.`);
                setLogs(prev => [...prev, `❌ [Batch] Ticket #${id} failed after 5 retries. Aborting batch.`]);
                abortBatchRef.current = true;
              } else {
                setLogs(prev => [...prev, `⚠️ [Batch] Ticket #${id} attempt ${retryCount} failed. Retrying...`]);
                // Optional: add a small delay before retry
                await new Promise(r => setTimeout(r, 1000));
              }
            }
          }
          if (abortBatchRef.current) break;
        }
      }

      if (abortBatchRef.current) {
        console.log("[Batch] Process stopped (aborted or max retries reached).");
        setLogs(prev => [...prev, "🛑 Batch translation stopped."]);
      } else {
        console.log("[Batch] All tasks completed successfully.");
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

  // Handle batch export to CSV
  async function handleBatchExport() {
    if (selectedIds.size === 0 || !outputDir) return;

    try {
      const filePath = await save({
        filters: [{
          name: 'CSV',
          extensions: ['csv']
        }],
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

  // Toggle selection for a single ticket
  const toggleTicketSelection = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Toggle select all visible
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredTickets.length && filteredTickets.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTickets.map(t => t.id)));
    }
  };

  // Handle translation
  async function handleTranslate(targetLang: 'cn' | 'en', force = false) {
    if (!selectedTicket || !outputDir) return;
    setIsTranslating(true);
    setDisplayLang(targetLang);
    try {
      if (!force) {
        // Check if translation exists locally by trying to load it
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

      // Trigger AI translation
      const translated = await invoke<Ticket>("translate_ticket_cmd", {
        outputDir,
        ticketId: selectedTicket.id,
        targetLang
      });

      // Update local state with new available language
      const updatedLangs = [...(selectedTicket.available_langs || []), targetLang];
      const deduplicated = Array.from(new Set(updatedLangs));
      setSelectedTicket({ ...translated, available_langs: deduplicated });
    } catch (error) {
      console.error("Translation error:", error);
      alert("Translation failed: " + error);
    }
    setIsTranslating(false);
  }

  // Handle switching back to original
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

  // Quick navigate to a ticket by ID
  const navigateToTicket = async (id: number) => {
    const found = tickets.find(t => t.id === id);
    if (found) {
      setSelectedTicket(found);
      // No need to reset displayLang here, as displayLang is now global
    } else {
      // If not in current list (maybe filtered?), try to load from storage
      try {
        const ticket = await invoke<Ticket | null>("load_ticket_cmd", {
          outputDir,
          ticketId: id,
          lang: displayLang === 'original' ? null : displayLang
        });
        if (ticket) {
          setSelectedTicket(ticket);
        } else {
          alert(`Ticket #${id} not found locally.`);
        }
      } catch (error) {
        console.error(error);
      }
    }
  };

  // Render text with clickable ticket links
  const renderTextWithLinks = (text: string | null) => {
    if (!text) return null;

    // Pattern for Chinese and English merge messages
    // Regex matches numbers after specific phrases
    const regex = /(合并到工单\s*|合并来自工单\s*|merged into ticket\s*|merged from ticket\s*)(\d+)/gi;

    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }

      const prefix = match[1];
      const ticketId = parseInt(match[2]);

      // Add clickable link
      parts.push(
        <span key={match.index}>
          {prefix}
          <button
            onClick={() => navigateToTicket(ticketId)}
            className="text-indigo-400 hover:text-indigo-300 hover:underline font-medium inline-block p-0 bg-transparent border-none cursor-pointer"
          >
            {ticketId}
          </button>
        </span>
      );

      lastIndex = regex.lastIndex;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return <>{parts}</>;
  };

  // Optimize filtering with useMemo
  const { filteredTickets, statusCounts } = useMemo(() => {
    const searchFiltered = tickets.filter((t) => {
      if (debouncedSearchQuery.trim()) {
        const query = debouncedSearchQuery.toLowerCase();
        const matchSubject = t.subject?.toLowerCase().includes(query);
        const matchDescription = t.description_text?.toLowerCase().includes(query);
        const matchConversations = t.conversations?.some(
          (c) => c.body_text?.toLowerCase().includes(query)
        );
        if (!matchSubject && !matchDescription && !matchConversations) return false;
      }
      return true;
    });

    const statusCounts = {
      all: searchFiltered.length,
      open: searchFiltered.filter(t => t.status === 2).length,
      pending: searchFiltered.filter(t => t.status === 3).length,
      resolved: searchFiltered.filter(t => t.status === 4).length,
      closed: searchFiltered.filter(t => t.status === 5).length,
    };

    const finalFiltered = searchFiltered.filter((t) => {
      if (statusFilter !== null && t.status !== statusFilter) return false;
      return true;
    });

    return { filteredTickets: finalFiltered, statusCounts };
  }, [tickets, debouncedSearchQuery, statusFilter]);

  const NavButton = ({ tab, icon, label }: { tab: 'sync' | 'browse' | 'settings'; icon: React.ReactNode; label: string }) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-200 group relative ${activeTab === tab ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-400 hover:bg-white/5 hover:text-white'
        }`}
    >
      {icon}
      <span className="absolute left-14 bg-slate-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
        {label}
      </span>
    </button>
  );

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-hidden">
      {/* Sidebar */}
      <div className="w-16 bg-slate-900/50 backdrop-blur-xl border-r border-white/10 flex flex-col items-center py-6">
        <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-indigo-500/25">F</div>
        <div className="flex-1 flex flex-col gap-2 mt-8">
          <NavButton tab="sync" label="Sync" icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>} />
          <NavButton tab="browse" label="Tickets" icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>} />
          <NavButton tab="settings" label="Settings" icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>} />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* SYNC PAGE */}
        {activeTab === 'sync' && (
          <div className="flex-1 flex flex-col p-6 overflow-hidden">
            <div className="mb-4">
              <h1 className="text-2xl font-bold text-white">Sync Tickets</h1>
              <p className="text-slate-400 text-sm">Synchronize tickets from Freshdesk</p>
            </div>

            {/* Sync Mode Toggle */}
            <div className="bg-white/5 rounded-xl border border-white/10 p-4 mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-white font-medium">Full Sync Mode</h3>
                  <p className="text-slate-400 text-xs">Download all tickets from {syncStartDate}</p>
                </div>
                <button
                  onClick={() => setFullSync(!fullSync)}
                  disabled={isSyncing}
                  className={`relative w-14 h-7 rounded-full transition-colors ${fullSync ? 'bg-indigo-500' : 'bg-slate-600'} ${isSyncing ? 'opacity-50' : ''}`}
                >
                  <span className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-transform ${fullSync ? 'left-8' : 'left-1'}`} />
                </button>
              </div>
              {fullSync && (
                <div className="mt-3 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                  <p className="text-yellow-400 text-xs">⚠️ Full sync from {syncStartDate}. Change start date in Settings if needed.</p>
                </div>
              )}
            </div>

            {/* Progress Bar */}
            {isSyncing && progress && (
              <div className="bg-white/5 rounded-xl border border-white/10 p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white font-medium text-sm">
                    {progress.phase === 'fetching' && '📥 Fetching tickets...'}
                    {progress.phase === 'processing' && `⚙️ Processing: ${progress.processed}/${progress.totalTickets}`}
                    {progress.phase === 'complete' && '✅ Complete!'}
                    {progress.phase === 'starting' && '🚀 Starting...'}
                  </span>
                  <span className="text-indigo-400 font-mono text-sm">{progress.current}%</span>
                </div>
                <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-300"
                    style={{ width: `${progress.current}%` }}
                  />
                </div>
                {progress.ticketId && (
                  <p className="text-slate-500 text-xs mt-2">Current: Ticket #{progress.ticketId}</p>
                )}
              </div>
            )}

            <button
              onClick={startSync}
              disabled={isSyncing}
              className={`w-full py-4 rounded-xl font-semibold text-white transition-all duration-300 flex items-center justify-center gap-3 mb-2 ${isSyncing ? 'bg-slate-700 cursor-not-allowed' : fullSync ? 'bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-400 hover:to-red-400 shadow-lg shadow-orange-500/25' : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-lg shadow-indigo-500/25'
                }`}
            >
              {isSyncing ? (
                <><svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>Syncing...</>
              ) : (
                <><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>{fullSync ? 'Start Full Sync' : 'Start Incremental Sync'}</>
              )}
            </button>

            {/* Sync Statuses Button */}
            <button
              onClick={async () => {
                setLogs((prev) => [...prev, "🔄 Syncing file statuses..."]);
                try {
                  const result = await invoke<[number, number]>("sync_statuses_cmd", { outputDir });
                  setLogs((prev) => [...prev, `✅ Status sync: ${result[0]} renamed / ${result[1]} total`]);
                  loadTickets();
                } catch (error) {
                  setLogs((prev) => [...prev, `❌ Error: ${error}`]);
                }
              }}
              disabled={isSyncing}
              className="w-full py-3 rounded-xl font-medium text-slate-300 transition-all duration-300 flex items-center justify-center gap-2 mb-4 bg-slate-700/50 border border-white/10 hover:bg-slate-700 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" /></svg>
              Sync File Statuses
            </button>

            {/* Console */}
            <div className="flex-1 bg-slate-950 rounded-xl border border-white/10 overflow-hidden flex flex-col min-h-0">
              <div className="px-4 py-2 border-b border-white/10 flex items-center gap-2 flex-shrink-0">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
                  <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
                </div>
                <span className="text-sm text-slate-400 ml-2">Console</span>
                <span className="text-xs text-slate-600 ml-auto">{logs.length} lines</span>
              </div>
              <div className="flex-1 p-4 overflow-y-auto font-mono text-xs bg-slate-950">
                {logs.length === 0 ? (
                  <p className="text-slate-500">Ready to sync...</p>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className={`py-0.5 ${log.includes('Error') || log.includes('❌') ? 'text-red-400' : log.includes('✅') ? 'text-green-400' : log.includes('⚠️') ? 'text-yellow-400' : 'text-slate-300'}`}>
                      {log}
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          </div>
        )}

        {/* BROWSE PAGE */}
        {activeTab === 'browse' && (
          <div className="flex-1 flex overflow-hidden">
            <div className="w-1/2 border-r border-white/10 flex flex-col relative">
              {/* Header with search */}
              <div className="p-4 border-b border-white/10 flex-shrink-0">
                <div className="flex items-center justify-between h-10 mb-4">
                  <div className="flex flex-col">
                    <h1 className="text-lg font-bold text-white leading-tight">Tickets</h1>
                    <p className="text-slate-400 text-[10px] leading-tight">{filteredTickets.length} / {tickets.length} shown</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Select All */}
                    <button
                      onClick={toggleSelectAll}
                      className="px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-slate-400 text-[10px] flex items-center gap-1.5 h-8"
                    >
                      <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${selectedIds.size > 0 ? 'bg-indigo-500 border-indigo-400' : 'border-white/20'}`}>
                        {selectedIds.size === filteredTickets.length && filteredTickets.length > 0 && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                        )}
                        {selectedIds.size > 0 && selectedIds.size < filteredTickets.length && (
                          <div className="w-1.5 h-0.5 bg-white rounded-full" />
                        )}
                      </div>
                      All
                    </button>

                    {/* List Language Filter */}
                    <div className="flex bg-slate-950 rounded-lg p-0.5 border border-white/10 h-8">
                      <button
                        onClick={() => { setIsLoadingTickets(true); setListLang('original'); }}
                        className={`px-3 py-1 text-xs rounded-md transition-all ${listLang === 'original' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                      >Original</button>
                      <button
                        onClick={() => { setIsLoadingTickets(true); setListLang('cn'); }}
                        className={`px-3 py-1 text-xs rounded-md transition-all ${listLang === 'cn' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                      >中文</button>
                      <button
                        onClick={() => { setIsLoadingTickets(true); setListLang('en'); }}
                        className={`px-3 py-1 text-xs rounded-md transition-all ${listLang === 'en' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                      >English</button>
                    </div>
                    <button onClick={() => loadTickets()} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-slate-300 text-sm h-8 flex items-center">Refresh</button>
                  </div>
                </div>

                {/* Search input */}
                <div className="relative mb-3">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search subject, description, conversations..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-slate-800/50 border border-white/10 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  )}
                </div>

                {/* Status filter tabs */}
                <div className="flex gap-1 flex-wrap">
                  <button
                    onClick={() => setStatusFilter(null)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 ${statusFilter === null ? 'bg-indigo-500 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'}`}
                  >All <span className="bg-white/20 px-1.5 rounded">{statusCounts.all}</span></button>
                  <button
                    onClick={() => setStatusFilter(2)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 ${statusFilter === 2 ? 'bg-green-500 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'}`}
                  >Open <span className="bg-white/20 px-1.5 rounded">{statusCounts.open}</span></button>
                  <button
                    onClick={() => setStatusFilter(3)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 ${statusFilter === 3 ? 'bg-yellow-500 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'}`}
                  >Pending <span className="bg-white/20 px-1.5 rounded">{statusCounts.pending}</span></button>
                  <button
                    onClick={() => setStatusFilter(4)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 ${statusFilter === 4 ? 'bg-blue-500 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'}`}
                  >Resolved <span className="bg-white/20 px-1.5 rounded">{statusCounts.resolved}</span></button>
                  <button
                    onClick={() => setStatusFilter(5)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 ${statusFilter === 5 ? 'bg-gray-500 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'}`}
                  >Closed <span className="bg-white/20 px-1.5 rounded">{statusCounts.closed}</span></button>
                </div>
              </div>

              {/* Ticket list */}
              <div className="flex-1 overflow-y-auto relative min-h-0">
                {filteredTickets.length === 0 ? (
                  <div className="p-4 text-center text-slate-500">
                    {searchQuery ? 'No tickets match your search' : 'No tickets found'}
                  </div>
                ) : (
                  filteredTickets.map((t) => (
                    <div
                      key={t.id}
                      onClick={() => { setSelectedTicket(t); setDisplayLang(listLang); }}
                      className={`group p-3 border-b border-white/5 cursor-pointer transition-all flex gap-3 ${selectedTicket?.id === t.id ? 'bg-indigo-500/10 border-l-2 border-l-indigo-500' : 'hover:bg-white/5'}`}
                    >
                      <div
                        onClick={(e) => { e.stopPropagation(); toggleTicketSelection(t.id); }}
                        className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-all ${selectedIds.has(t.id) ? 'bg-indigo-500 border-indigo-400' : 'border-white/20 group-hover:border-white/40'}`}
                      >
                        {selectedIds.has(t.id) && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500">#{t.id}</span>
                            <div className="flex gap-1">
                              {t.available_langs?.map(l => getLangLabel(l))}
                            </div>
                          </div>
                          {getStatusBadge(t.status)}
                        </div>
                        <h3 className="text-white text-sm font-medium truncate">{t.subject || '(No Subject)'}</h3>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Batch Action Bar */}
              {selectedIds.size > 0 && !batchProgress && (
                <div className="absolute bottom-4 left-4 right-4 bg-indigo-600 rounded-xl shadow-2xl shadow-indigo-500/40 p-3 flex flex-col gap-3 z-30 animate-in fade-in slide-in-from-bottom-4 duration-300 border border-indigo-400/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center text-white font-bold text-xs">
                        {selectedIds.size}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-white text-xs font-bold leading-tight">Tickets Selected</span>
                        <button onClick={() => setSelectedIds(new Set())} className="text-indigo-200 text-[10px] hover:text-white transition-colors text-left">Deselect all</button>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => handleBatchTranslate(['cn'])}
                      className="px-2 py-1.5 bg-white text-indigo-600 rounded-lg text-xs font-bold hover:bg-indigo-50 transition-all flex items-center justify-center gap-1.5"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" /></svg>
                      CN
                    </button>
                    <button
                      onClick={() => handleBatchTranslate(['en'])}
                      className="px-2 py-1.5 bg-indigo-500 text-white border border-indigo-400 rounded-lg text-xs font-bold hover:bg-indigo-400 transition-all flex items-center justify-center gap-1.5"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" /></svg>
                      EN
                    </button>
                    <button
                      onClick={() => handleBatchTranslate(['cn', 'en'])}
                      className="px-2 py-1.5 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-lg text-xs font-bold hover:from-blue-400 hover:to-purple-400 transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-blue-500/20"
                    >
                      CN & EN
                    </button>
                  </div>
                  <button
                    onClick={handleBatchExport}
                    className="w-full py-2 bg-indigo-500/50 hover:bg-indigo-400 text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 border border-indigo-400/50"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    Export to CSV (.csv)
                  </button>
                </div>
              )}

              {isLoadingTickets && !batchProgress && (
                <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] z-40 flex items-center justify-center rounded-r-lg">
                  <div className="flex flex-col items-center gap-2">
                    <svg className="animate-spin h-6 w-6 text-indigo-400" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span className="text-xs text-indigo-300 font-medium">Loading tickets...</span>
                  </div>
                </div>
              )}
              {batchProgress && (
                <div className="absolute inset-0 bg-indigo-900/40 backdrop-blur-md z-50 flex items-center justify-center p-6 rounded-r-lg">
                  <div className="bg-slate-900 border border-indigo-500/30 rounded-2xl p-6 w-full max-w-sm shadow-2xl overflow-hidden relative">
                    <div className="absolute top-0 left-0 h-1 bg-indigo-500 transition-all duration-300" style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }} />
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-white font-bold">Batch Processing</h3>
                        <p className="text-slate-400 text-xs">Translating via Gemini AI</p>
                      </div>
                      <span className="text-indigo-400 font-mono text-sm font-bold">{Math.round((batchProgress.current / batchProgress.total) * 100)}%</span>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden mb-4">
                      <div
                        className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-300"
                        style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-500 mb-4">
                      <span>Task {batchProgress.current} of {batchProgress.total}</span>
                      <span className="animate-pulse">Please wait...</span>
                    </div>
                    <button
                      onClick={() => {
                        console.log("[Batch] Abort button clicked");
                        abortBatchRef.current = true;
                        setIsAborting(true);
                      }}
                      disabled={isAborting}
                      className={`w-full py-2 border text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2 ${isAborting ? 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed' : 'bg-red-500/20 hover:bg-red-500/30 border-red-500/30 text-red-400'}`}
                    >
                      {isAborting ? (
                        <>
                          <svg className="animate-spin h-3.5 w-3.5 text-slate-500" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Stopping...
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          Abort Process
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 flex flex-col bg-slate-800/30 overflow-hidden">
              {selectedTicket ? (
                <>
                  <div className="px-4 py-4 border-b border-white/10 flex-shrink-0 flex items-center justify-between h-[72px]">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-indigo-400 text-[10px] leading-tight">#{selectedTicket.id}</span>
                        <div className="flex gap-1">
                          {selectedTicket.available_langs?.map(l => getLangLabel(l))}
                        </div>
                      </div>
                      <h2 className="text-lg font-bold text-white truncate leading-tight">{selectedTicket.subject}</h2>
                    </div>

                    {/* Language Toggle */}
                    <div className="flex bg-slate-950 rounded-lg p-0.5 border border-white/10 h-8 flex-shrink-0">
                      <button
                        onClick={handleSwitchToOriginal}
                        disabled={isTranslating}
                        className={`px-3 py-1 text-xs rounded-md transition-all ${displayLang === 'original' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                      >Original</button>
                      <button
                        onClick={() => handleTranslate('cn')}
                        disabled={isTranslating}
                        className={`px-3 py-1 text-xs rounded-md transition-all flex items-center gap-1.5 ${displayLang === 'cn' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                      >
                        <span className="flex items-center gap-1">
                          {isTranslating && displayLang === 'cn' ? '...' : '中文'}
                          {displayLang === 'cn' && !isTranslating && (
                            <div
                              onClick={(e) => { e.stopPropagation(); handleTranslate('cn', true); }}
                              className="hover:bg-white/20 p-0.5 rounded transition-colors"
                              title="Re-translate"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                            </div>
                          )}
                        </span>
                      </button>
                      <button
                        onClick={() => handleTranslate('en')}
                        disabled={isTranslating}
                        className={`px-3 py-1 text-xs rounded-md transition-all flex items-center gap-1.5 ${displayLang === 'en' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                      >
                        <span className="flex items-center gap-1">
                          {isTranslating && displayLang === 'en' ? '...' : 'English'}
                          {displayLang === 'en' && !isTranslating && (
                            <div
                              onClick={(e) => { e.stopPropagation(); handleTranslate('en', true); }}
                              className="hover:bg-white/20 p-0.5 rounded transition-colors"
                              title="Re-translate"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                            </div>
                          )}
                        </span>
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4">
                    {isTranslating && (
                      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm z-10 flex items-center justify-center">
                        <div className="text-white flex flex-col items-center">
                          <svg className="animate-spin h-8 w-8 mb-2" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                          <span>Translating with Gemini AI...</span>
                        </div>
                      </div>
                    )}
                    <div className="bg-white/5 rounded-lg p-3 mb-4">
                      <p className="text-slate-200 text-sm whitespace-pre-wrap">
                        {renderTextWithLinks(selectedTicket.description_text) || 'No description'}
                      </p>
                    </div>
                    {selectedTicket.conversations?.map((conv) => (
                      <div key={conv.id} className={`p-3 rounded-lg mb-2 ${conv.incoming ? 'bg-slate-700/50 mr-6' : 'bg-indigo-500/20 ml-6'}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${conv.incoming ? 'bg-slate-600 text-slate-300' : 'bg-indigo-500/30 text-indigo-300'}`}>{conv.incoming ? 'Customer' : 'Agent'}</span>
                          <span className="text-xs text-slate-500">{conv.created_at.substring(0, 16)}</span>
                        </div>
                        <p className="text-slate-200 text-sm whitespace-pre-wrap">{renderTextWithLinks(conv.body_text)}</p>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-slate-500">Select a ticket</div>
              )}
            </div>
          </div>
        )}

        {/* SETTINGS PAGE */}
        {activeTab === 'settings' && (
          <div className="flex-1 p-6 overflow-auto">
            <h1 className="text-2xl font-bold text-white mb-1">Settings</h1>
            <p className="text-slate-400 text-sm mb-6">Configure your Freshdesk connection</p>

            <div className="max-w-lg space-y-4">
              <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                <label className="block text-sm font-medium text-slate-300 mb-2">Output Directory</label>
                <div className="flex gap-2">
                  <input value={outputDir} onChange={(e) => setOutputDir(e.target.value)} className="flex-1 px-4 py-3 bg-slate-800/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50" placeholder="data" />
                  <button onClick={selectFolder} className="px-4 py-3 bg-slate-700/50 border border-white/10 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition-all flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>Browse
                  </button>
                </div>
              </div>

              <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                <label className="block text-sm font-medium text-slate-300 mb-2">API Key</label>
                <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="w-full px-4 py-3 bg-slate-800/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50" placeholder="Enter your Freshdesk API Key" />
                <p className="text-xs text-slate-500 mt-2">Find your API key in Freshdesk → Profile Settings → API Key</p>
              </div>

              <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                <label className="block text-sm font-medium text-slate-300 mb-2">Full Sync Start Date</label>
                <input
                  type="month"
                  value={syncStartDate}
                  onChange={(e) => setSyncStartDate(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-800/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
                <p className="text-xs text-slate-500 mt-2">When using Full Sync, tickets will be fetched starting from this month</p>
              </div>

              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 flex items-center gap-2">
                <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                <span className="text-green-400 text-sm">Settings are saved automatically</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
