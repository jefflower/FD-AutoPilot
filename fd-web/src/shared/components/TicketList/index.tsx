import React, { useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import TicketListItem from './TicketListItem';
import Pagination from './Pagination';
import { THEME_MAP } from './types';
import type { TicketListProps } from './types';

// Re-export types for consumers
export type { TicketListProps, ThemeColor, TitleMode, PaginationConfig } from './types';

const TicketList: React.FC<TicketListProps> = ({
  tickets,
  selectedId,
  onSelect,
  themeColor = 'indigo',
  titleMode = 'auto',
  selectable = false,
  selectedIds,
  onSelectionChange,
  renderActions,
  renderExtra,
  renderStatus,
  pagination,
  loading = false,
  emptyText,
  className,
  density = 'normal',
}) => {
  const { t } = useTranslation('common');
  const scrollRef = useRef<HTMLDivElement>(null);

  const theme = useMemo(() => THEME_MAP[themeColor], [themeColor]);

  // ---- Select-all logic ----
  const allChecked = useMemo(() => {
    if (!selectable || !selectedIds || tickets.length === 0) return false;
    return tickets.every((tk) => selectedIds.has(tk.id));
  }, [selectable, selectedIds, tickets]);

  const handleSelectAll = useCallback(() => {
    if (!onSelectionChange) return;
    if (allChecked) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(tickets.map((tk) => tk.id)));
    }
  }, [allChecked, onSelectionChange, tickets]);

  // ---- Individual checkbox ----
  const handleCheckChange = useCallback(
    (ticketId: number, checked: boolean) => {
      if (!onSelectionChange || !selectedIds) return;
      const next = new Set(selectedIds);
      if (checked) {
        next.add(ticketId);
      } else {
        next.delete(ticketId);
      }
      onSelectionChange(next);
    },
    [onSelectionChange, selectedIds],
  );

  // ---- Infinite scroll ----
  const handleScroll = useCallback(() => {
    if (!pagination || pagination.mode !== 'infinite') return;
    if (!pagination.hasMore || pagination.loadingMore) return;

    const el = scrollRef.current;
    if (!el) return;

    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight - scrollTop - clientHeight < 80) {
      pagination.loadMore();
    }
  }, [pagination]);

  // ---- Empty / Loading ----
  const isEmpty = !loading && tickets.length === 0;
  const resolvedEmptyText = emptyText || t('ticketList.empty', { defaultValue: '暂无工单' });

  return (
    <div className={`flex flex-col h-full ${className || ''}`}>
      {/* Select-all header */}
      {selectable && tickets.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={handleSelectAll}
            className={`w-3.5 h-3.5 rounded ${theme.accent}`}
          />
          <span className="text-[10px] text-slate-500">
            {t('ticketList.selectAll')}{' '}
            {selectedIds && selectedIds.size > 0 && (
              <span className={theme.accent}>
                ({t('ticketList.selectedCount', { count: selectedIds.size })})
              </span>
            )}
          </span>
        </div>
      )}

      {/* Scrollable list area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {/* Loading spinner */}
        {loading && tickets.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
          </div>
        )}

        {/* Empty state */}
        {isEmpty && (
          <div className="flex items-center justify-center py-12">
            <span className="text-xs text-slate-500">{resolvedEmptyText}</span>
          </div>
        )}

        {/* Ticket items */}
        {tickets.length > 0 && (
          <div className="space-y-1 p-2">
            {tickets.map((ticket) => (
              <TicketListItem
                key={ticket.id}
                ticket={ticket}
                isSelected={selectedId === ticket.id}
                theme={theme}
                titleMode={titleMode}
                density={density}
                onSelect={onSelect}
                selectable={selectable}
                isChecked={selectedIds?.has(ticket.id)}
                onCheckChange={handleCheckChange}
                renderActions={renderActions}
                renderExtra={renderExtra}
                renderStatus={renderStatus}
              />
            ))}
          </div>
        )}

        {/* Infinite scroll: loading more */}
        {pagination?.mode === 'infinite' && pagination.loadingMore && (
          <div className="flex items-center justify-center py-3">
            <div className="w-4 h-4 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            <span className="ml-2 text-[10px] text-slate-500">
              {t('ticketList.loadingMore', { defaultValue: '加载更多...' })}
            </span>
          </div>
        )}
      </div>

      {/* Pages pagination */}
      {pagination?.mode === 'pages' && (
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          totalElements={pagination.totalElements}
          onPageChange={pagination.onPageChange}
        />
      )}
    </div>
  );
};

TicketList.displayName = 'TicketList';

export default TicketList;
