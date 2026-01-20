import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Ticket } from '../types';

export function useTickets(outputDir: string) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [displayLang, setDisplayLang] = useState<'original' | 'cn' | 'en'>('original');
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);
  const [listLang, setListLang] = useState<'original' | 'cn' | 'en'>('original');
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<number | null>(null);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  async function loadTickets() {
    if (!outputDir) return;
    setIsLoadingTickets(true);
    try {
      const list = await invoke<Ticket[]>("list_local_tickets", {
        outputDir,
        lang: listLang === 'original' ? null : listLang
      });
      setTickets(list || []);
    } catch (error) {
      console.error(error);
    }
    setIsLoadingTickets(false);
  }

  useEffect(() => { loadTickets(); }, [outputDir, listLang]);

  const memoizedData = useMemo(() => {
    const searchFiltered = (tickets || []).filter((t) => {
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

    const counts = {
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

    return { filteredTickets: finalFiltered, statusCounts: counts };
  }, [tickets, debouncedSearchQuery, statusFilter]);

  // Quick navigate to a ticket by ID
  const navigateToTicket = async (id: number) => {
    const found = tickets.find(t => t.id === id);
    if (found) {
      setSelectedTicket(found);
    } else {
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

  return {
    tickets,
    selectedTicket, setSelectedTicket,
    displayLang, setDisplayLang,
    isLoadingTickets, setIsLoadingTickets,
    listLang, setListLang,
    searchQuery, setSearchQuery,
    statusFilter, setStatusFilter,
    filteredTickets: memoizedData.filteredTickets,
    statusCounts: memoizedData.statusCounts,
    loadTickets,
    navigateToTicket
  };
}
