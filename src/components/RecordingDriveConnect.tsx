"use client";

import { useEffect, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import { clientErrorMessage } from "@/lib/client-error";

type StorageStatus = {
  connected: boolean;
  accountEmail: string;
  folderConfigured: boolean;
  folderName: string;
};

type PickerDocument = { id?: string; name?: string; mimeType?: string };
type PickerInstance = { setVisible(visible: boolean): void };
type PickerDocsView = {
  setIncludeFolders(include: boolean): PickerDocsView;
  setSelectFolderEnabled(enabled: boolean): PickerDocsView;
  setEnableDrives(enabled: boolean): PickerDocsView;
  setMode(mode: string): PickerDocsView;
};
type PickerBuilder = {
  addView(view: PickerDocsView): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(projectNumber: string): PickerBuilder;
  setCallback(callback: (data: Record<string, unknown>) => void): PickerBuilder;
  build(): PickerInstance;
};
type PickerApi = {
  DocsView: new (viewId: string) => PickerDocsView;
  PickerBuilder: new () => PickerBuilder;
  ViewId: { DOCS: string };
};
type PickerWindow = Window & {
  gapi?: { load(name: string, options: { callback: () => void; onerror?: () => void }): void };
  google?: { picker?: PickerApi };
};

const EMPTY_STATUS: StorageStatus = { connected: false, accountEmail: "", folderConfigured: false, folderName: "" };

async function ensurePickerLoaded() {
  const pickerWindow = window as PickerWindow;
  if (!pickerWindow.gapi) {
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-google-picker-loader="true"]');
      const script = existing || document.createElement("script");
      script.src = "https://apis.google.com/js/api.js";
      script.async = true;
      script.defer = true;
      script.dataset.googlePickerLoader = "true";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Google Drive folder picker could not be loaded."));
      if (!existing) document.head.appendChild(script);
    });
  }

  const loadedWindow = window as PickerWindow;
  if (!loadedWindow.gapi) throw new Error("Google Drive folder picker is unavailable.");
  if (!loadedWindow.google?.picker) {
    await new Promise<void>((resolve, reject) => {
      loadedWindow.gapi?.load("picker", {
        callback: resolve,
        onerror: () => reject(new Error("Google Drive folder picker could not be initialized.")),
      });
    });
  }
  const picker = (window as PickerWindow).google?.picker;
  if (!picker) throw new Error("Google Drive folder picker is unavailable.");
  return picker;
}

export default function RecordingDriveConnect() {
  const [status, setStatus] = useState<StorageStatus>(EMPTY_STATUS);
  const [loading, setLoading] = useState(true);
  const [openingPicker, setOpeningPicker] = useState(false);
  const [savingFolder, setSavingFolder] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("recording-drive");
    if (result) {
      if (result === "connected") setMessage("Google Drive connected. Choose the folder where this organization's recordings should be saved.");
      else if (result === "denied") setError(params.get("recording-drive-reason") || "Google Drive connection was cancelled.");
      else setError(params.get("recording-drive-reason") || "Google Drive could not be connected. Please try again.");
      const url = new URL(window.location.href);
      url.searchParams.delete("recording-drive");
      url.searchParams.delete("recording-drive-reason");
      window.history.replaceState({}, "", url.toString());
    }

    fetch("/api/auth/google-recording-drive/status", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to check Google Drive status.");
        setStatus({
          connected: data.connected === true,
          accountEmail: typeof data.accountEmail === "string" ? data.accountEmail : "",
          folderConfigured: data.folderConfigured === true,
          folderName: typeof data.folderName === "string" ? data.folderName : "",
        });
      })
      .catch((caught) => setError(clientErrorMessage(caught, "Unable to check Google Drive status.")))
      .finally(() => setLoading(false));
  }, []);

  async function chooseFolder() {
    setOpeningPicker(true);
    setError("");
    setMessage("");
    try {
      const accessResponse = await fetch("/api/organization/recording-drive/picker-token", { cache: "no-store" });
      const access = await accessResponse.json();
      if (!accessResponse.ok || access.success !== true) throw new Error(access.error || "Unable to open Google Drive.");
      const pickerApi = await ensurePickerLoaded();
      const view = new pickerApi.DocsView(pickerApi.ViewId.DOCS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setEnableDrives(true)
        .setMode("list");
      const picker = new pickerApi.PickerBuilder()
        .addView(view)
        .setOAuthToken(access.accessToken)
        .setDeveloperKey(access.apiKey)
        .setAppId(access.projectNumber)
        .setCallback((data) => {
          if (data.action !== "picked") {
            setOpeningPicker(false);
            return;
          }
          const docs = Array.isArray(data.docs) ? data.docs as PickerDocument[] : [];
          const selected = docs[0];
          if (!selected?.id) {
            setError("Choose a Google Drive folder to continue.");
            setOpeningPicker(false);
            return;
          }
          void saveFolder(selected.id);
        })
        .build();
      picker.setVisible(true);
    } catch (caught) {
      setError(clientErrorMessage(caught, "Unable to open Google Drive. Please try again."));
      setOpeningPicker(false);
    }
  }

  async function saveFolder(folderId: string) {
    setSavingFolder(true);
    setError("");
    try {
      const response = await fetch("/api/organization/recording-drive/folder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId }),
      });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to save this Google Drive folder.");
      setStatus((current) => ({ ...current, folderConfigured: true, folderName: data.folderName || "Selected folder" }));
      setMessage(`New interview recordings will be saved in “${data.folderName || "Selected folder"}”.`);
    } catch (caught) {
      setError(clientErrorMessage(caught, "Unable to save this Google Drive folder."));
    } finally {
      setSavingFolder(false);
      setOpeningPicker(false);
    }
  }

  return <section className="card calendar-connect-card recording-drive-connect-card">
    <div className="card-header">
      <h2>Live Avatar recording storage</h2>
      {!loading && status.connected && status.folderConfigured
        ? <span className="calendar-status-pill calendar-status-connected">Ready</span>
        : !loading && status.connected
          ? <span className="calendar-status-pill calendar-status-warning">Choose a folder</span>
          : null}
    </div>
    <div className="calendar-connect-body">
      {loading && <p>Checking this organization's Google Drive connection…</p>}
      {error && <ActionFeedback kind="error">{error}</ActionFeedback>}
      {message && <ActionFeedback kind="success">{message}</ActionFeedback>}
      {!loading && !status.connected && <>
        <p>Connect a Google account for this organization. Interview recordings will be saved to a folder you select.</p>
        <a className="btn btn-primary" href="/api/auth/google-recording-drive/connect">Connect Google Drive</a>
      </>}
      {!loading && status.connected && <>
        <p>Connected account: <strong>{status.accountEmail}</strong></p>
        <p>{status.folderConfigured ? <>Recording folder: <strong>{status.folderName}</strong></> : "Choose a folder to finish setup."}</p>
        <div className="recording-drive-actions">
          <button type="button" className="btn btn-primary" onClick={() => void chooseFolder()} disabled={openingPicker || savingFolder}>
            {openingPicker || savingFolder ? "Opening Google Drive…" : status.folderConfigured ? "Change folder" : "Choose recording folder"}
          </button>
          <a className="btn btn-secondary" href="/api/auth/google-recording-drive/connect">Change Google account</a>
        </div>
      </>}
      <p className="recording-drive-note">Choose My Drive or a Shared Drive folder where this account can add files. Recordings remain private and are only played through the portal for authorized HR reviewers. This connection applies to this organization only.</p>
    </div>
  </section>;
}
