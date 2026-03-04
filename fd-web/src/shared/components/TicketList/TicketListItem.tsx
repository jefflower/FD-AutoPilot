import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TICKET_STATUS_COLORS, getTicketStatusLabel, getFdStatusLabel, getFdStatusColor, getTicketCategoryLabel, getTicketCategoryColor } from '../../utils/statusLabels';
import type { TicketListItemProps } from './types';

/** Resolve the display title based on titleMode */
function resolveTitle(
  ticket: TicketListItemProps['ticket'],
  mode: TicketListItemProps['titleMode'],
): string {
  if (mode === 'original') {
    return ticket.subject;
  }
  // 'translated' and 'auto' both prefer the translated title
  return (
    ticket.translatedTitle ||
    ticket.translation?.translatedTitle ||
    ticket.subject
  );
}

const TicketListItem: React.FC<TicketListItemProps> = ({
  ticket,
  isSelected,
  theme,
  titleMode,
  density,
  onSelect,
  selectable,
  isChecked,
  onCheckChange,
  renderActions,
  renderExtra,
  renderStatus,
}) => {
  const { t } = useTranslation('common');

  const title = useMemo(() => resolveTitle(ticket, titleMode), [ticket, titleMode]);

  const handleClick = useCallback(() => {
    onSelect?.(ticket);
  }, [onSelect, ticket]);

  const handleCheckboxClick = useCallback(
    (e: React.MouseEvent<HTMLInputElement>) => {
      e.stopPropagation();
    },
    [],
  );

  const handleCheckboxChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onCheckChange?.(ticket.id, e.target.checked);
    },
    [onCheckChange, ticket.id],
  );

  const paddingClass = density === 'compact' ? 'px-3 py-1.5' : 'px-3 py-2.5';

  const statusColorClass = TICKET_STATUS_COLORS[ticket.status] || TICKET_STATUS_COLORS[''];

  return (
    <div
      role="button"
      tabIndex={0}
      data-ticket-id={ticket.id}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      className={`
        group relative cursor-pointer rounded-lg border border-transparent transition-all duration-150
        ${paddingClass}
        ${
          isSelected
            ? `${theme.selected} ${theme.shadow}`
            : 'hover:bg-white/[0.03] hover:border-white/5'
        }
      `}
    >
      {/* Left indicator bar */}
      {isSelected && (
        <div
          className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-full ${theme.indicator}`}
        />
      )}

      {/* Row 1: checkbox + ID + actions + status */}
      <div className="flex items-center gap-1.5 min-w-0">
        {selectable && (
          <input
            type="checkbox"
            checked={isChecked}
            onClick={handleCheckboxClick}
            onChange={handleCheckboxChange}
            className={`w-3.5 h-3.5 rounded flex-shrink-0 ${theme.accent}`}
          />
        )}

        <span className={`text-[10px] font-mono font-bold flex-shrink-0 ${theme.id}`}>
          #{ticket.externalId || ticket.id}
        </span>

        {/* Spacer */}
        <div className="flex-1 min-w-0" />

        {/* Hover actions */}
        {renderActions && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 flex items-center gap-1">
            {renderActions(ticket)}
          </div>
        )}

        {/* 工单分类 badge（仅在有 ticketCategory 时显示） */}
        {ticket.ticketCategory && (
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ring-1 ring-inset ${getTicketCategoryColor(ticket.ticketCategory)}`}
          >
            {getTicketCategoryLabel(ticket.ticketCategory)}
          </span>
        )}

        {/* Freshdesk 状态 badge（仅在有 fdStatus 时显示） */}
        {ticket.fdStatus != null && (
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded ring-1 font-medium flex-shrink-0 ${getFdStatusColor(ticket.fdStatus)}`}
            title={`Freshdesk: ${getFdStatusLabel(ticket.fdStatus)}`}
          >
            FD:{getFdStatusLabel(ticket.fdStatus)}
          </span>
        )}

        {/* Status badge */}
        {renderStatus ? (
          renderStatus(ticket)
        ) : (
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${statusColorClass}`}
          >
            {getTicketStatusLabel(t, ticket.status)}
          </span>
        )}
      </div>

      {/* Row 2: Title */}
      <div className="mt-1">
        <p className="text-[11px] text-slate-300 truncate font-medium group-hover:text-white transition-colors">
          {title}
        </p>
      </div>

      {/* Row 3: Extra content */}
      {renderExtra && (
        <div className="mt-1">{renderExtra(ticket)}</div>
      )}
    </div>
  );
};

TicketListItem.displayName = 'TicketListItem';

export default React.memo(TicketListItem);
