import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Progress } from '../types';

export function useSync(apiKey: string, outputDir: string, syncStartDate: string, loadTickets: () => void) {
  const [logs, setLogs] = useState<string[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [fullSync, setFullSync] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

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

  async function syncStatuses() {
    setLogs((prev) => [...prev, "🔄 Syncing file statuses..."]);
    try {
      const result = await invoke<[number, number]>("sync_statuses_cmd", { outputDir });
      setLogs((prev) => [...prev, `✅ Status sync: ${result[0]} renamed / ${result[1]} total`]);
      loadTickets();
    } catch (error) {
      setLogs((prev) => [...prev, `❌ Error: ${error}`]);
    }
  }

  return {
    logs, setLogs,
    isSyncing,
    progress,
    fullSync, setFullSync,
    logsEndRef,
    startSync,
    syncStatuses
  };
}
