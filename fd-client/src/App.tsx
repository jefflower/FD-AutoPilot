import { useState } from "react";
import "./index.css";
import Sidebar from "./components/Sidebar";
import SyncTab from "./components/SyncTab";
import BrowseTab from "./components/BrowseTab";
import SettingsTab from "./components/SettingsTab";
import { useSettings } from "./hooks/useSettings";
import { useSync } from "./hooks/useSync";
import { useTickets } from "./hooks/useTickets";
import { useTranslation } from "./hooks/useTranslation";
import MQTaskRunner from "./components/MQTaskRunner";

function App() {
  const [activeTab, setActiveTab] = useState<'sync' | 'browse' | 'settings'>('sync');

  // Logic Hooks
  const {
    apiKey, setApiKey,
    outputDir, setOutputDir,
    syncStartDate, setSyncStartDate,
    mqHost, setMqHost,
    mqPort, setMqPort,
    mqUsername, setMqUsername,
    mqPassword, setMqPassword,
    notebookLMConfig, setNotebookLMConfig
  } = useSettings();

  const {
    tickets,
    selectedTicket, setSelectedTicket,
    displayLang, setDisplayLang,
    isLoadingTickets, setIsLoadingTickets,
    listLang, setListLang,
    searchQuery, setSearchQuery,
    statusFilter, setStatusFilter,
    filteredTickets, statusCounts,
    loadTickets,
    navigateToTicket
  } = useTickets(outputDir);

  const {
    logs, setLogs,
    isSyncing,
    progress,
    fullSync, setFullSync,
    logsEndRef,
    startSync,
    syncStatuses
  } = useSync(apiKey, outputDir, syncStartDate, loadTickets);

  const {
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
  } = useTranslation(
    outputDir,
    tickets,
    selectedTicket,
    setSelectedTicket,
    setDisplayLang,
    setIsLoadingTickets,
    loadTickets,
    setLogs
  );

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-hidden">
      {/* Sidebar Navigation */}
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {activeTab === 'sync' && (
          <SyncTab
            isSyncing={isSyncing}
            progress={progress}
            fullSync={fullSync}
            setFullSync={setFullSync}
            syncStartDate={syncStartDate}
            startSync={startSync}
            syncStatuses={syncStatuses}
            logs={logs}
            logsEndRef={logsEndRef}
          />
        )}

        {activeTab === 'browse' && (
          <BrowseTab
            tickets={tickets}
            filteredTickets={filteredTickets}
            selectedTicket={selectedTicket}
            setSelectedTicket={setSelectedTicket}
            isLoadingTickets={isLoadingTickets}
            loadTickets={loadTickets}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            statusCounts={statusCounts}
            listLang={listLang}
            setListLang={setListLang}
            selectedIds={selectedIds}
            toggleSelectAll={() => {
              if (selectedIds.size === filteredTickets.length && filteredTickets.length > 0) {
                setSelectedIds(new Set());
              } else {
                setSelectedIds(new Set(filteredTickets.map(t => t.id)));
              }
            }}
            toggleTicketSelection={toggleTicketSelection}
            handleBatchTranslate={handleBatchTranslate}
            handleBatchExport={() => handleBatchExport(listLang)}
            batchProgress={batchProgress}
            isAborting={isAborting}
            abortBatchRef={abortBatchRef}
            setIsAborting={setIsAborting}
            displayLang={displayLang}
            setDisplayLang={setDisplayLang}
            isTranslating={isTranslating}
            handleTranslate={handleTranslate}
            handleSwitchToOriginal={handleSwitchToOriginal}
            navigateToTicket={navigateToTicket}
            setLogs={setLogs}
            notebookLMConfig={notebookLMConfig}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsTab
            apiKey={apiKey}
            setApiKey={setApiKey}
            outputDir={outputDir}
            setOutputDir={setOutputDir}
            syncStartDate={syncStartDate}
            setSyncStartDate={setSyncStartDate}
            mqHost={mqHost}
            setMqHost={setMqHost}
            mqPort={mqPort}
            setMqPort={setMqPort}
            mqUsername={mqUsername}
            setMqUsername={setMqUsername}
            mqPassword={mqPassword}
            setMqPassword={setMqPassword}
            notebookLMConfig={notebookLMConfig}
            setNotebookLMConfig={setNotebookLMConfig}
            setLogs={setLogs}
          />
        )}
      </div>
      {/* Global Task Runners */}
      <MQTaskRunner notebookLMConfig={notebookLMConfig} setLogs={setLogs} />
    </div>
  );
}

export default App;
