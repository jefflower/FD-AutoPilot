import React from 'react';
import { Ticket, NotebookLMConfig } from '../types';
import TicketList from './TicketList';
import TicketDetail from './TicketDetail';

interface BrowseTabProps {
    tickets: Ticket[];
    filteredTickets: Ticket[];
    selectedTicket: Ticket | null;
    setSelectedTicket: (t: Ticket | null) => void;
    isLoadingTickets: boolean;
    loadTickets: () => void;
    searchQuery: string;
    setSearchQuery: (q: string) => void;
    statusFilter: number | null;
    setStatusFilter: (f: number | null) => void;
    statusCounts: { all: number; open: number; pending: number; resolved: number; closed: number };
    listLang: 'original' | 'cn' | 'en';
    setListLang: (l: 'original' | 'cn' | 'en') => void;

    // Translation & Batch logic
    selectedIds: Set<number>;
    toggleSelectAll: () => void;
    toggleTicketSelection: (id: number) => void;
    handleBatchTranslate: (langs: ('cn' | 'en')[]) => void;
    handleBatchExport: () => void;
    batchProgress: { current: number; total: number } | null;
    isAborting: boolean;
    abortBatchRef: React.MutableRefObject<boolean>;
    setIsAborting: (b: boolean) => void;

    // Detail props
    displayLang: 'original' | 'cn' | 'en';
    setDisplayLang: (l: 'original' | 'cn' | 'en') => void;
    isTranslating: boolean;
    handleTranslate: (lang: 'cn' | 'en', force?: boolean) => void;
    handleSwitchToOriginal: () => void;
    navigateToTicket: (id: number) => void;
    setLogs: (updater: (prev: string[]) => string[]) => void;
    notebookLMConfig: NotebookLMConfig;
}

const BrowseTab: React.FC<BrowseTabProps> = (props) => {
    return (
        <div className="flex-1 flex overflow-hidden">
            <TicketList
                tickets={props.tickets}
                filteredTickets={props.filteredTickets}
                selectedTicket={props.selectedTicket}
                setSelectedTicket={(t) => { props.setSelectedTicket(t); props.setDisplayLang(props.listLang); }}
                selectedIds={props.selectedIds}
                toggleSelectAll={props.toggleSelectAll}
                toggleTicketSelection={props.toggleTicketSelection}
                listLang={props.listLang}
                setListLang={props.setListLang}
                setDisplayLang={props.setDisplayLang}
                isLoadingTickets={props.isLoadingTickets}
                loadTickets={props.loadTickets}
                searchQuery={props.searchQuery}
                setSearchQuery={props.setSearchQuery}
                statusFilter={props.statusFilter}
                setStatusFilter={props.setStatusFilter}
                statusCounts={props.statusCounts}
                handleBatchTranslate={props.handleBatchTranslate}
                handleBatchExport={props.handleBatchExport}
                batchProgress={props.batchProgress}
                isAborting={props.isAborting}
                abortBatchRef={props.abortBatchRef}
                setIsAborting={props.setIsAborting}
            />

            <div className="flex-1 flex flex-col bg-slate-800/30 overflow-hidden">
                {props.selectedTicket ? (
                    <TicketDetail
                        selectedTicket={props.selectedTicket}
                        displayLang={props.displayLang}
                        isTranslating={props.isTranslating}
                        handleSwitchToOriginal={props.handleSwitchToOriginal}
                        handleTranslate={props.handleTranslate}
                        navigateToTicket={props.navigateToTicket}
                        setLogs={props.setLogs}
                        notebookLMConfig={props.notebookLMConfig}
                    />
                ) : (
                    <div className="flex-1 flex items-center justify-center text-slate-500">Select a ticket</div>
                )}
            </div>
        </div>
    );
};

export default BrowseTab;
