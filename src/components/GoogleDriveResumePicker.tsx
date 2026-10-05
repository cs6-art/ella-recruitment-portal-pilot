"use client";

import { useEffect, useRef } from "react";

import type { CloudImportSelection } from "@/lib/cloud-import-request";
import { clientErrorMessage } from "@/lib/client-error";

type PickerDocument = { id?: string; name?: string; mimeType?: string };
type PickerInstance = { setVisible(visible: boolean): void };
type PickerDocsView = {
  setIncludeFolders(include: boolean): PickerDocsView;
  setSelectFolderEnabled(enabled: boolean): PickerDocsView;
  setEnableDrives(enabled: boolean): PickerDocsView;
  setMimeTypes(mimeTypes: string): PickerDocsView;
  setParent(parentId: string): PickerDocsView;
  setOwnedByMe(ownedByMe: boolean): PickerDocsView;
  setLabel(label: string): PickerDocsView;
  setMode(mode: string): PickerDocsView;
};
type PickerBuilder = {
  addView(view: PickerDocsView): PickerBuilder;
  enableFeature(feature: string): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(projectNumber: string): PickerBuilder;
  setOrigin(origin: string): PickerBuilder;
  setSize(width: number, height: number): PickerBuilder;
  setCallback(callback: (data: Record<string, unknown>) => void): PickerBuilder;
  build(): PickerInstance;
};
type PickerApi = {
  DocsView: new (viewId: string) => PickerDocsView;
  PickerBuilder: new () => PickerBuilder;
  ViewId: { DOCS: string };
  Feature: { MULTISELECT_ENABLED: string; SUPPORT_DRIVES: string };
};
type PickerWindow = Window & {
  gapi?: { load(name: string, options: { callback: () => void; onerror?: () => void }): void };
  google?: { picker?: PickerApi };
};

const RESUME_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
].join(",");
const GAPI_SRC = "https://apis.google.com/js/api.js";

let gapiLoad: Promise<void> | null = null;

function loadGapi() {
  if (!gapiLoad) {
    gapiLoad = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GAPI_SRC;
      script.async = true;
      script.addEventListener("load", () => resolve(), { once: true });
      script.addEventListener("error", () => { script.remove(); reject(new Error("The Google Drive chooser could not be loaded.")); }, { once: true });
      document.head.appendChild(script);
    }).catch((error: unknown) => {
      gapiLoad = null;
      throw error;
    });
  }
  return gapiLoad;
}

async function ensurePicker() {
  await loadGapi();
  const loadedWindow = window as PickerWindow;
  if (!loadedWindow.gapi) throw new Error("The Google Drive chooser is unavailable.");
  if (!loadedWindow.google?.picker) {
    await new Promise<void>((resolve, reject) => {
      loadedWindow.gapi?.load("picker", { callback: resolve, onerror: () => reject(new Error("The Google Drive chooser could not be initialized.")) });
    });
  }
  const picker = loadedWindow.google?.picker;
  if (!picker) throw new Error("The Google Drive chooser is unavailable.");
  return picker;
}

/**
 * Google Picker for resume import. With the `drive.file` scope the portal can
 * only read files the user picks here, so there is no folder browsing on our
 * side. Renders nothing; it opens Google's own dialog while `open` is true.
 */
export default function GoogleDriveResumePicker({
  open,
  onClose,
  onImport,
  onError,
  maxSelection,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (files: CloudImportSelection[]) => void;
  onError: (message: string, reconnect?: boolean) => void;
  maxSelection: number;
}) {
  const callbacks = useRef({ onClose, onImport, onError, maxSelection });
  callbacks.current = { onClose, onImport, onError, maxSelection };

  useEffect(() => {
    if (!open) return;
    let active = true;
    let picker: PickerInstance | null = null;

    void (async () => {
      try {
        const [pickerApi, response] = await Promise.all([ensurePicker(), fetch("/api/auth/google-drive/picker", { cache: "no-store" })]);
        const data = await response.json() as { success?: boolean; accessToken?: string; apiKey?: string; projectNumber?: string; error?: string; code?: string };
        if (!active) return;
        if (!response.ok || data.success !== true || !data.accessToken || !data.apiKey || !data.projectNumber) {
          callbacks.current.onError(data.error || "Unable to open the Google Drive chooser.", data.code === "DRIVE_NOT_CONNECTED" || data.code === "DRIVE_RECONNECT_REQUIRED");
          callbacks.current.onClose();
          return;
        }

        // setEnableDrives turns a view into a Shared-drives-only view, so My
        // Drive and files shared with the account each need their own tab.
        const view = (label: string) => new pickerApi.DocsView(pickerApi.ViewId.DOCS)
          .setIncludeFolders(true)
          .setSelectFolderEnabled(false)
          .setMimeTypes(RESUME_MIME_TYPES)
          .setLabel(label)
          .setMode("list");
        const built: PickerInstance = new pickerApi.PickerBuilder()
          .addView(view("My Drive").setParent("root"))
          .addView(view("Shared with me").setOwnedByMe(false))
          .addView(view("Shared drives").setEnableDrives(true))
          .enableFeature(pickerApi.Feature.MULTISELECT_ENABLED)
          .enableFeature(pickerApi.Feature.SUPPORT_DRIVES)
          .setOAuthToken(data.accessToken)
          .setDeveloperKey(data.apiKey)
          .setAppId(data.projectNumber)
          .setOrigin(window.location.origin)
          .setSize(900, 600)
          .setCallback((result) => {
            if (result.action === "loaded") return;
            built.setVisible(false);
            picker = null;
            if (!active) return;
            if (result.action !== "picked") { callbacks.current.onClose(); return; }
            const docs = (Array.isArray(result.docs) ? result.docs as PickerDocument[] : []).filter((doc) => doc.id && doc.name);
            if (docs.length === 0) { callbacks.current.onClose(); return; }
            if (docs.length > callbacks.current.maxSelection) {
              callbacks.current.onError(`Choose at most ${callbacks.current.maxSelection} resumes at a time.`);
              callbacks.current.onClose();
              return;
            }
            callbacks.current.onImport(docs.map((doc) => ({ id: doc.id as string, name: doc.name as string, mimeType: doc.mimeType || "" })));
          })
          .build();
        picker = built;
        built.setVisible(true);
      } catch (caught) {
        if (!active) return;
        callbacks.current.onError(clientErrorMessage(caught, "Unable to open the Google Drive chooser."));
        callbacks.current.onClose();
      }
    })();

    return () => {
      active = false;
      picker?.setVisible(false);
    };
  }, [open]);

  return null;
}
