"use client";

type PaginationProps = {
  page: number;
  totalPages: number;
  totalItems: number;
  /** Optional history-backed total shown in the summary while paging live rows. */
  displayTotalItems?: number;
  pageSize: number;
  pageSizeOptions?: readonly number[];
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
};

type PageItem = number | "ellipsis-left" | "ellipsis-right" | "empty";

function pageItems(page: number, totalPages: number): PageItem[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

  // Keep seven page slots in the control so moving between pages never shifts
  // the Next/Last buttons horizontally.
  if (page <= 3) return [1, 2, 3, 4, "ellipsis-right", totalPages - 1, totalPages];
  if (page >= totalPages - 2) return [1, "ellipsis-left", totalPages - 3, totalPages - 2, totalPages - 1, totalPages, "empty"];
  return [1, "ellipsis-left", page - 1, page, page + 1, "ellipsis-right", totalPages];
}

export default function Pagination({ page, totalPages, totalItems, displayTotalItems = totalItems, pageSize, pageSizeOptions, onPageChange, onPageSizeChange }: PaginationProps) {
  if (totalItems === 0) return null;

  const currentPage = Math.min(Math.max(page, 1), Math.max(totalPages, 1));
  const firstItem = (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="pagination-summary">Showing {firstItem}-{lastItem} of {displayTotalItems}</span>
      {onPageSizeChange && pageSizeOptions && <label className="pagination-size-control">Rows per page<select aria-label="Rows per page" value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>{pageSizeOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>}
      <div className="pagination-controls">
        <button type="button" className="pagination-button pagination-wide-button" disabled={currentPage === 1} onClick={() => onPageChange(1)}>First</button>
        <button type="button" className="pagination-button pagination-wide-button" disabled={currentPage === 1} onClick={() => onPageChange(currentPage - 1)}>Previous</button>
        <div className="pagination-pages">
          {pageItems(currentPage, totalPages).map((item, index) => item === "empty" ? (
            <span className="pagination-slot" aria-hidden="true" key={`empty-${index}`} />
          ) : item === "ellipsis-left" || item === "ellipsis-right" ? (
            <span className="pagination-ellipsis" key={`${item}-${index}`}>…</span>
          ) : (
            <button type="button" className={`pagination-button pagination-page-button ${item === currentPage ? "pagination-page-active" : ""}`} aria-current={item === currentPage ? "page" : undefined} aria-label={`Page ${item}`} key={`${item}-${index}`} onClick={() => onPageChange(item)}>{item}</button>
          ))}
        </div>
        <button type="button" className="pagination-button pagination-wide-button" disabled={currentPage === totalPages} onClick={() => onPageChange(currentPage + 1)}>Next</button>
        <button type="button" className="pagination-button pagination-wide-button" disabled={currentPage === totalPages} onClick={() => onPageChange(totalPages)}>Last</button>
      </div>
    </nav>
  );
}
