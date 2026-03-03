import React, { useMemo, useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface CsvViewerProps {
    content: string;
    maxRows?: number;
}

/** 简易 CSV 解析器，支持引号内逗号和换行 */
function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let current = '';
    let inQuotes = false;
    let row: string[] = [];

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const next = text[i + 1];

        if (inQuotes) {
            if (ch === '"' && next === '"') {
                current += '"';
                i++; // skip escaped quote
            } else if (ch === '"') {
                inQuotes = false;
            } else {
                current += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                row.push(current.trim());
                current = '';
            } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
                row.push(current.trim());
                if (row.some(cell => cell.length > 0)) {
                    rows.push(row);
                }
                row = [];
                current = '';
                if (ch === '\r') i++; // skip \n in \r\n
            } else {
                current += ch;
            }
        }
    }

    // Last row
    if (current.length > 0 || row.length > 0) {
        row.push(current.trim());
        if (row.some(cell => cell.length > 0)) {
            rows.push(row);
        }
    }

    return rows;
}

const CsvViewer: React.FC<CsvViewerProps> = ({ content, maxRows = 200 }) => {
    const [sortCol, setSortCol] = useState<number | null>(null);
    const [sortAsc, setSortAsc] = useState(true);

    const { headers, rows } = useMemo(() => {
        const allRows = parseCsv(content);
        if (allRows.length === 0) return { headers: [], rows: [] };
        return {
            headers: allRows[0],
            rows: allRows.slice(1, maxRows + 1),
        };
    }, [content, maxRows]);

    const sortedRows = useMemo(() => {
        if (sortCol === null) return rows;
        return [...rows].sort((a, b) => {
            const va = a[sortCol] || '';
            const vb = b[sortCol] || '';
            // 尝试数字比较
            const na = parseFloat(va);
            const nb = parseFloat(vb);
            if (!isNaN(na) && !isNaN(nb)) {
                return sortAsc ? na - nb : nb - na;
            }
            return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
        });
    }, [rows, sortCol, sortAsc]);

    const handleSort = (colIdx: number) => {
        if (sortCol === colIdx) {
            setSortAsc(!sortAsc);
        } else {
            setSortCol(colIdx);
            setSortAsc(true);
        }
    };

    if (headers.length === 0) {
        return <p className="text-xs text-slate-500 italic">Empty CSV</p>;
    }

    return (
        <div className="rounded-lg border border-white/10 overflow-hidden">
            <div className="overflow-auto max-h-[500px] custom-scrollbar">
                <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 z-10">
                        <tr className="bg-slate-800">
                            <th className="px-2 py-2 text-[10px] text-slate-500 font-mono font-normal border-b border-white/10 text-center w-10">
                                #
                            </th>
                            {headers.map((h, i) => (
                                <th
                                    key={i}
                                    onClick={() => handleSort(i)}
                                    className="px-3 py-2 text-left text-[10px] text-amber-400 font-bold border-b border-white/10 cursor-pointer hover:bg-white/5 select-none whitespace-nowrap"
                                >
                                    <span className="flex items-center gap-1">
                                        {h || `Col ${i + 1}`}
                                        {sortCol === i && (
                                            sortAsc
                                                ? <ChevronUp size={10} />
                                                : <ChevronDown size={10} />
                                        )}
                                    </span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {sortedRows.map((row, ri) => (
                            <tr
                                key={ri}
                                className={`${ri % 2 === 0 ? 'bg-white/[0.02]' : ''} hover:bg-white/5 transition-colors`}
                            >
                                <td className="px-2 py-1.5 text-[10px] text-slate-600 font-mono text-center border-b border-white/5">
                                    {ri + 1}
                                </td>
                                {headers.map((_, ci) => (
                                    <td
                                        key={ci}
                                        className="px-3 py-1.5 text-slate-300 font-mono border-b border-white/5 max-w-[300px] truncate"
                                        title={row[ci] || ''}
                                    >
                                        {row[ci] || ''}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="px-3 py-1.5 bg-slate-800/50 border-t border-white/10 flex items-center justify-between">
                <span className="text-[10px] text-slate-500">
                    {sortedRows.length} 行 × {headers.length} 列
                </span>
                {rows.length >= maxRows && (
                    <span className="text-[10px] text-amber-400/60">
                        仅显示前 {maxRows} 行
                    </span>
                )}
            </div>
        </div>
    );
};

export default CsvViewer;
