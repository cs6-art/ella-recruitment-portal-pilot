"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { CloudImportSelection } from "@/lib/cloud-import-request";

type DriveFolder = { id: string; name: string };
type DriveSharedDrive = { id: string; name: string };
type DriveFile = CloudImportSelection & { size: number; modifiedTime: string };

const DEFAULT_MAX_SELECTION = 25;

function formatSize(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DriveFilePicker({
  open,
  onClose,
  onImport,
  importing,
  listUrl = "/api/resume-screening/drive/list",
  pageParam = "pageToken",
  providerLabel = "Google Drive",
  rootName = "My Drive",
  initialFolderId = "root",
  maxSelection = DEFAULT_MAX_SELECTION,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (files: DriveFile[]) => void;
  importing: boolean;
  listUrl?: string;
  pageParam?: string;
  providerLabel?: string;
  rootName?: string;
  initialFolderId?: string;
  maxSelection?: number;
}) {
  const MAX_SELECTION = maxSelection;
  const [folderId, setFolderId] = useState(initialFolderId || "root");
  const [breadcrumb, setBreadcrumb] = useState<DriveFolder[]>([{ id: "root", name: rootName }]);
  const [sharedDrives, setSharedDrives] = useState<DriveSharedDrive[]>([]);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  // Retain the complete validated row, not only its ID. This keeps the
  // filename/mime-type-to-file-ID mapping intact through a picker rerender or
  // pagination and prevents a container ID from being reconstructed later.
  const [selected, setSelected] = useState<Map<string, DriveFile>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const loadVersion = useRef(0);

  const load = useCallback(async (targetFolderId: string, pageToken?: string) => {
    const version = ++loadVersion.current;
    if (!pageToken) { setFiles([]); setSelected(new Map()); }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ folderId: targetFolderId });
      if (pageToken) params.set(pageParam, pageToken);
      const response = await fetch(`${listUrl}?${params}`, { cache: "no-store" });
      const data = await response.json();
      if (version !== loadVersion.current) return;
      if (!response.ok || data.success !== true) throw new Error(data.error || `Unable to read that ${providerLabel} folder.`);
      setFolderId(data.folderId);
      setBreadcrumb(data.breadcrumb || [{ id: "root", name: rootName }]);
      setSharedDrives(data.sharedDrives || []);
      setFolders(data.folders || []);
      const returnedFolders = new Set<string>((data.folders || []).map((folder: DriveFolder) => folder.id).filter(Boolean));
      returnedFolders.add(targetFolderId);
      for (const drive of data.sharedDrives || []) returnedFolders.add(drive.id);
      for (const crumb of data.breadcrumb || []) returnedFolders.add(crumb.id);
      const selectableFiles = (data.files || []).filter((file: DriveFile) => (
        Boolean(file.id && file.name)
        && file.id !== "root"
        && !returnedFolders.has(file.id)
        && file.isFolder !== true
        && file.mimeType !== "application/vnd.google-apps.folder"
        && ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(file.mimeType || "")
        && /\.(pdf|docx?|doc)$/i.test(file.name)
      ));
      setFiles((current) => (pageToken ? [...current, ...selectableFiles] : selectableFiles));
      setNextPageToken(data.nextPageToken || null);
    } catch (caught) {
      if (version !== loadVersion.current) return;
      setError(caught instanceof Error ? caught.message : `Unable to read that ${providerLabel} folder.`);
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [listUrl, pageParam, providerLabel, rootName]);

  useEffect(() => {
    setSelected(new Map());
    if (!open) { loadVersion.current += 1; setFiles([]); return; }
    void load(initialFolderId || "root");
    return () => { loadVersion.current += 1; };
  }, [open, initialFolderId, load]);

  if (!open) return null;

  const navigate = (id: string) => { setSelected(new Map()); void load(id); };
  const toggle = (file: DriveFile) => {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(file.id)) next.delete(file.id);
      else if (next.size < MAX_SELECTION) next.set(file.id, file);
      return next;
    });
  };

  return (
    <div className="drive-picker-backdrop" role="dialog" aria-modal="true" aria-label={`Choose resumes from ${providerLabel}`} onClick={onClose}>
      <div className="drive-picker" onClick={(event) => event.stopPropagation()}>
        <div className="drive-picker-head">
          <h3>Choose resumes from {providerLabel}</h3>
          <button type="button" className="drive-picker-close" aria-label="Close" onClick={onClose}>×</button>
        </div>

        <div className="drive-picker-breadcrumb">
          {breadcrumb.map((crumb, index) => (
            <span key={crumb.id}>
              {index > 0 && <span aria-hidden="true"> / </span>}
              <button type="button" className="drive-picker-crumb" disabled={crumb.id === folderId} onClick={() => navigate(crumb.id)}>{crumb.name}</button>
            </span>
          ))}
        </div>

        {error && <div className="error-box">{error}</div>}

        <div className="drive-picker-list">
          {sharedDrives.length > 0 && (
            <div className="drive-picker-shared-drives" aria-label="Shared Drives">
              <strong>Shared Drives</strong>
              {sharedDrives.map((sharedDrive) => (
                <button type="button" key={sharedDrive.id} className="drive-picker-row drive-picker-folder" onClick={() => navigate(sharedDrive.id)}>
                  <span aria-hidden="true">▣</span> <span>{sharedDrive.name}</span>
                </button>
              ))}
            </div>
          )}
          {folders.map((folder) => (
            <button type="button" key={folder.id} className="drive-picker-row drive-picker-folder" onClick={() => navigate(folder.id)}>
              <span aria-hidden="true">📁</span> <span>{folder.name}</span>
            </button>
          ))}
          {files.map((file) => (
            <label key={file.id} className={`drive-picker-row drive-picker-file${selected.has(file.id) ? " is-selected" : ""}`}>
              <input type="checkbox" checked={selected.has(file.id)} disabled={importing || (!selected.has(file.id) && selected.size >= MAX_SELECTION)} onChange={() => toggle(file)} />
              <span className="drive-picker-file-name">{file.name}</span>
              <span className="drive-picker-file-meta">{formatSize(file.size)}</span>
            </label>
          ))}
          {!loading && folders.length === 0 && files.length === 0 && <p className="drive-picker-empty">No folders or PDF/DOC/DOCX files here.</p>}
          {loading && <p className="drive-picker-empty">Loading…</p>}
          {nextPageToken && !loading && (
            <button type="button" className="btn btn-secondary drive-picker-more" onClick={() => void load(folderId, nextPageToken)}>Load more</button>
          )}
        </div>

        <div className="drive-picker-foot">
          <span>{selected.size} selected{selected.size >= MAX_SELECTION ? ` (max ${MAX_SELECTION})` : ""}</span>
          <div>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={importing}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={importing || loading || selected.size === 0}
              onClick={() => {
                const selectedFiles = Array.from(selected.values());
                const loadedIds = new Set(files.map((file) => file.id));
                if (selectedFiles.some((file) => !loadedIds.has(file.id))) {
                  setError("One selected Drive file is no longer available. Refresh the folder and select it again.");
                  return;
                }
                console.info("[Drive Picker] selection", { folderId, sharedDriveIds: sharedDrives.map((drive) => drive.id), files: selectedFiles.map(({ id, name }) => ({ id, name })) });
                setSelected(new Map());
                onImport(selectedFiles);
              }}
            >
              {importing ? "Importing…" : `Import ${selected.size} file${selected.size === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
