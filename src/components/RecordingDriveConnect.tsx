"use client";

import { useEffect, useRef, useState } from "react";

import ActionFeedback from "@/components/ActionFeedback";
import { clientErrorMessage } from "@/lib/client-error";

type StorageStatus = {
  connected: boolean;
  accountEmail: string;
  folderConfigured: boolean;
  folderName: string;
};

type PickerConfig = { clientId: string; apiKey: string; projectNumber: string };
type TokenResponse = { access_token?: string; scope?: string; error?: string; error_description?: string };
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
type TokenClient = { requestAccessToken(options?: { login_hint?: string }): void };
type TokenClientConfig = {
  client_id: string;
  scope: string;
  callback: (response: TokenResponse) => void;
  error_callback?: (error: { type?: string }) => void;
};
type PickerApi = {
  DocsView: new (viewId: string) => PickerDocsView;
  PickerBuilder: new () => PickerBuilder;
  ViewId: { DOCS: string };
};
type PickerWindow = Window & {
  gapi?: { load(name: string, options: { callback: () => void; onerror?: () => void }): void };
  google?: {
    picker?: PickerApi;
    accounts?: { oauth2?: { initTokenClient(config: TokenClientConfig): TokenClient } };
  };
};

const EMPTY_STATUS: StorageStatus = { connected: false, accountEmail: "", folderConfigured: false, folderName: "" };
const PICKER_SCOPE = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email";
const googleScriptLoads = new Map<string, Promise<void>>();

function loadGoogleScript(src: string, marker: string) {
  const cached = googleScriptLoads.get(src);
  if (cached) return cached;

  const scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[${marker}="true"]`);
    if (existing?.dataset.loaded === "true") {
      resolve();
      return;
    }
    const script = existing || document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.setAttribute(marker, "true");
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => {
      script.remove();
      reject(new Error("Google Drive folder picker could not be loaded."));
    }, { once: true });
    if (!existing) document.head.appendChild(script);
  }).catch((error: unknown) => {
    googleScriptLoads.delete(src);
    throw error;
  });

  googleScriptLoads.set(src, scriptPromise);
  return scriptPromise;
}

async function ensurePickerLoaded() {
  await Promise.all([
    loadGoogleScript("https://apis.google.com/js/api.js", "data-google-picker-loader"),
    loadGoogleScript("https://accounts.google.com/gsi/client", "data-google-identity-loader"),
  ]);

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
  const picker = loadedWindow.google?.picker;
  const oauth2 = loadedWindow.google?.accounts?.oauth2;
  if (!picker || !oauth2) throw new Error("Google Drive folder picker is unavailable.");
  return { picker, oauth2 };
}

export default function RecordingDriveConnect() {
  const [status, setStatus] = useState<StorageStatus>(EMPTY_STATUS);
  const [loading, setLoading] = useState(true);
  const [pickerSetupLoading, setPickerSetupLoading] = useState(false);
  const [pickerReady, setPickerReady] = useState(false);
  const [pickerSetupAttempt, setPickerSetupAttempt] = useState(0);
  const [openingPicker, setOpeningPicker] = useState(false);
  const [savingFolder, setSavingFolder] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pickerApiRef = useRef<PickerApi | null>(null);
  const pickerConfigRef = useRef<PickerConfig | null>(null);
  const tokenClientRef = useRef<TokenClient | null>(null);
  const tokenResponseHandlerRef = useRef<((response: TokenResponse) => void) | null>(null);
  const tokenErrorHandlerRef = useRef<((error: { type?: string }) => void) | null>(null);

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

  useEffect(() => {
    if (loading || !status.connected) {
      setPickerReady(false);
      pickerConfigRef.current = null;
      tokenClientRef.current = null;
      pickerApiRef.current = null;
      return;
    }

    let active = true;
    setPickerSetupLoading(true);
    fetch("/api/organization/recording-drive/picker-config", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || data.success !== true) throw new Error(data.error || "Unable to prepare Drive folder selection.");
        const config: PickerConfig = {
          clientId: typeof data.clientId === "string" ? data.clientId : "",
          apiKey: typeof data.apiKey === "string" ? data.apiKey : "",
          projectNumber: typeof data.projectNumber === "string" ? data.projectNumber : "",
        };
        if (!config.clientId || !config.apiKey || !config.projectNumber) throw new Error("Google Drive folder selection is not configured.");
        return { config, apis: ensurePickerLoaded() };
      })
      .then(async ({ config, apis }) => {
        const { picker, oauth2 } = await apis;
        if (!active) return;
        pickerApiRef.current = picker;
        pickerConfigRef.current = config;
        tokenClientRef.current = oauth2.initTokenClient({
          client_id: config.clientId,
          scope: PICKER_SCOPE,
          callback: (response) => {
            const handler = tokenResponseHandlerRef.current;
            tokenResponseHandlerRef.current = null;
            tokenErrorHandlerRef.current = null;
            handler?.(response);
          },
          error_callback: (pickerError) => {
            const handler = tokenErrorHandlerRef.current;
            tokenResponseHandlerRef.current = null;
            tokenErrorHandlerRef.current = null;
            handler?.(pickerError);
          },
        });
        setPickerReady(true);
      })
      .catch((caught) => {
        if (active) setError(clientErrorMessage(caught, "Unable to prepare Drive folder selection."));
      })
      .finally(() => {
        if (active) setPickerSetupLoading(false);
      });

    return () => {
      active = false;
      tokenResponseHandlerRef.current = null;
      tokenErrorHandlerRef.current = null;
    };
  }, [loading, pickerSetupAttempt, status.connected]);

  function showFolderPicker(response: TokenResponse) {
    const accessToken = response.access_token;
    if (response.error || !accessToken) {
      setError(response.error_description || "Google Drive access was not granted. Try again and allow file access.");
      setOpeningPicker(false);
      return;
    }
    if (!response.scope?.split(/\s+/).includes("https://www.googleapis.com/auth/drive.file")) {
      setError("Google Drive file access was not granted. Reconnect Google Drive and try again.");
      setOpeningPicker(false);
      return;
    }

    // This short-lived token comes directly from Google Identity Services after
    // the user's click; it is held only in memory and passed only to Google
    // Picker, never to a Smile API or persistent browser storage.
    void (async () => {
      try {
        const identityResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        if (!identityResponse.ok) throw new Error("Google could not verify the selected account.");
        const identity = await identityResponse.json() as { email?: string };
        if ((identity.email || "").trim().toLowerCase() !== status.accountEmail.trim().toLowerCase()) {
          throw new Error(`Select the connected Google account (${status.accountEmail}) to choose this organization's folder.`);
        }

        const pickerApi = pickerApiRef.current;
        const pickerConfig = pickerConfigRef.current;
        if (!pickerApi || !pickerConfig) throw new Error("Google Drive folder picker is unavailable. Try again.");

        const view = new pickerApi.DocsView(pickerApi.ViewId.DOCS)
          .setIncludeFolders(true)
          .setSelectFolderEnabled(true)
          .setEnableDrives(true)
          .setMode("list");
        const picker = new pickerApi.PickerBuilder()
          .addView(view)
          .setOAuthToken(accessToken)
          .setDeveloperKey(pickerConfig.apiKey)
          .setAppId(pickerConfig.projectNumber)
          .setCallback((data) => {
            if (data.action !== "picked") {
              picker.setVisible(false);
              setOpeningPicker(false);
              return;
            }
            const docs = Array.isArray(data.docs) ? data.docs as PickerDocument[] : [];
            const selected = docs[0];
            picker.setVisible(false);
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
    })();
  }

  function chooseFolder() {
    setError("");
    setMessage("");
    const tokenClient = tokenClientRef.current;
    if (!pickerReady || !tokenClient) {
      setError("The folder chooser is still getting ready. Try again in a moment.");
      return;
    }
    setOpeningPicker(true);
    tokenResponseHandlerRef.current = showFolderPicker;
    tokenErrorHandlerRef.current = (pickerError) => {
      setError(pickerError.type === "popup_closed" ? "Google Drive connection was cancelled." : "Google could not open the account approval window. Allow pop-ups and try again.");
      setOpeningPicker(false);
    };
    try {
      // Invoke Google's token dialog synchronously from the user's click so
      // browser popup protections recognize this as an intentional action.
      tokenClient.requestAccessToken({ login_hint: status.accountEmail });
    } catch (caught) {
      tokenResponseHandlerRef.current = null;
      tokenErrorHandlerRef.current = null;
      setError(clientErrorMessage(caught, "Unable to request Google Drive access."));
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

  return <section id="recording-drive-settings-title" className="card calendar-connect-card recording-drive-connect-card">
    <div className="card-header">
      <h2>Google Drive for Live Avatar recordings</h2>
      {!loading && status.connected && status.folderConfigured
        ? <span className="calendar-status-pill calendar-status-connected">Ready</span>
        : !loading && status.connected
          ? <span className="calendar-status-pill calendar-status-warning">Choose a folder</span>
          : null}
    </div>
    <div className="calendar-connect-body">
      {loading && <p role="status">Checking this organization's Google Drive connection…</p>}
      {error && <ActionFeedback kind="error">{error}</ActionFeedback>}
      {message && <ActionFeedback kind="success">{message}</ActionFeedback>}
      {!loading && !status.connected && <>
        <p>Connect a Google account for this organization. Interview recordings will be saved to a folder you select.</p>
        <a className="btn btn-primary" href="/api/auth/google-recording-drive/connect">Connect Google Drive</a>
      </>}
      {!loading && status.connected && <>
        {pickerSetupLoading && <p role="status">Preparing secure folder selection…</p>}
        <p>Connected account: <strong>{status.accountEmail}</strong></p>
        <p>{status.folderConfigured ? <>Recording folder: <strong>{status.folderName}</strong></> : "Choose a folder to finish setup."}</p>
        <div className="recording-drive-actions">
          <button type="button" className="btn btn-primary" onClick={chooseFolder} disabled={!pickerReady || openingPicker || savingFolder}>
            {openingPicker || savingFolder ? "Opening Google Drive…" : pickerSetupLoading ? "Preparing folder chooser…" : status.folderConfigured ? "Change folder" : "Choose recording folder"}
          </button>
          {!pickerReady && !pickerSetupLoading && !loading && <button type="button" className="btn btn-secondary" onClick={() => { setError(""); setPickerSetupAttempt((attempt) => attempt + 1); }}>Try again</button>}
          <a className="btn btn-secondary" href="/api/auth/google-recording-drive/connect">Change Google account</a>
        </div>
      </>}
      <p className="recording-drive-note">Choose a My Drive or Shared Drive folder where this account can add files. Recordings stay private and can only be played in the portal by authorized HR reviewers. This connection applies to this organization only.</p>
    </div>
  </section>;
}
