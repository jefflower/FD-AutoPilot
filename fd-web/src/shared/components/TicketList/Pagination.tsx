import React from 'react';
import { useTranslation } from 'react-i18next';
import type { PaginationProps } from './types';

const Pagination: React.FC<PaginationProps> = ({
  page,
  totalPages,
  totalElements,
  onPageChange,
}) => {
  const { t } = useTranslation('common');

  return (
    <div className="flex items-center justify-between px-3 py-2 border-t border-white/5">
      <span className="text-[10px] text-slate-500">
        {t('ticketList.pageInfo', {
          total: totalElements,
          current: page + 1,
          pages: totalPages,
        })}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={page <= 0}
          onClick={() => onPageChange(page - 1)}
          className="px-2.5 py-1 bg-white/5 text-slate-400 rounded text-[10px] hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {t('button.previousPage')}
        </button>
        <button
          type="button"
          disabled={page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
          className="px-2.5 py-1 bg-white/5 text-slate-400 rounded text-[10px] hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {t('button.nextPage')}
        </button>
      </div>
    </div>
  );
};

Pagination.displayName = 'Pagination';

export default Pagination;
