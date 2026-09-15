"use client";

import { useMemo, useState } from "react";

import Pagination from "@/components/Pagination";
import UiIcon from "@/components/UiIcon";
import type { CandidateStatusHistoryEntry } from "@/lib/candidate-applications";
import { applicantDecisionLabel, applicantStageLabel, historySourceLabel, historyStageLabel } from "@/lib/applicant-stage-labels";
import { formatPortalDateTime } from "@/lib/portal-time";

const PAGE_SIZE = 5;

function entryTitle(entry: CandidateStatusHistoryEntry) {
  if (entry.previousStatus) return `${applicantStageLabel(entry.previousStatus)} → ${applicantStageLabel(entry.newStatus)}`;
  return applicantStageLabel(entry.newStatus) || applicantDecisionLabel(entry.action) || entry.action;
}

export default function CandidateHistoryTimeline({ history }: { history: CandidateStatusHistoryEntry[] }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(history.length / PAGE_SIZE));
  const visible = useMemo(() => history.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [history, page]);

  return (
    <section className="card applicant-detail-card history-card">
      <div className="card-header applicant-section-header">
        <div className="applicant-section-heading">
          <span className="applicant-section-icon"><UiIcon name="clock" size={17} /></span>
          <div><h2>Candidate Status History</h2><p>Review what happened with this candidate and when.</p></div>
        </div>
      </div>
      {history.length === 0
        ? <div className="empty">No candidate status history is available.</div>
        : <>
          <div className="history-timeline">
            {visible.map((entry, index) => {
              const source = historySourceLabel(entry.actionSource);
              return (
                <article className="timeline-entry" key={`${entry.historyId || entry.changedAt}-${index}`}>
                  <span className="timeline-marker" aria-hidden="true" />
                  <div className="timeline-content">
                    <div className="timeline-top">
                      <div>
                        <h3>{entryTitle(entry)}</h3>
                        <span className="timeline-action">{historyStageLabel(entry.stage)} · {applicantDecisionLabel(entry.action) || entry.action}</span>
                      </div>
                      <time dateTime={entry.changedAt}>{formatPortalDateTime(entry.changedAt, true)}</time>
                    </div>
                    {(entry.changedByName || entry.changedByEmail) && <div className="timeline-performer"><strong>{entry.changedByName}</strong><span>{entry.changedByEmail}</span></div>}
                    {source && <div className="timeline-meta">{source}</div>}
                    {entry.comments && <p className="timeline-comments">{entry.comments}</p>}
                    {entry.rejectionReason && <div className="history-entry-comments"><span>Rejection reason</span><p>{entry.rejectionReason}</p></div>}
                  </div>
                </article>
              );
            })}
          </div>
          {history.length > PAGE_SIZE && <Pagination page={page} totalPages={totalPages} totalItems={history.length} pageSize={PAGE_SIZE} onPageChange={setPage} />}
        </>}
    </section>
  );
}
