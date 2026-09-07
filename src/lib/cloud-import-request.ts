export type CloudImportProvider = "google" | "microsoft";

export type CloudImportSelection = {
  id: string;
  name: string;
  mimeType?: string;
  isFolder?: boolean;
  isSharedDrive?: boolean;
  driveId?: string;
  parentId?: string;
  parentIds?: string[];
};

const FOLDER_MIME = "application/vnd.google-apps.folder";
const RESUME_EXT = /\.(pdf|docx?|doc)$/i;

/**
 * Convert picker rows into the only values the import endpoint should receive.
 * The ID is taken from the selected file row itself; folder breadcrumbs,
 * shared-drive roots, and stale IDs are never accepted as file selections.
 */
export function selectedCloudFileIds(selections: CloudImportSelection[]) {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const selection of selections) {
    const id = selection.id.trim();
    const name = selection.name.trim();
    const mimeType = (selection.mimeType || "").trim();
    const containerIds = new Set([
      selection.driveId?.trim(),
      selection.parentId?.trim(),
      ...(selection.parentIds || []).map((parentId) => parentId.trim()),
    ].filter(Boolean));
    if (!id || id === "root" || !name || selection.isFolder === true || selection.isSharedDrive === true || containerIds.has(id) || mimeType === FOLDER_MIME || !RESUME_EXT.test(name) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function selectedCloudFiles(selections: CloudImportSelection[]) {
  const ids = selectedCloudFileIds(selections);
  const allowed = new Set(ids);
  return selections
    .filter((selection) => allowed.has(selection.id.trim()))
    .map((selection) => ({
      id: selection.id.trim(),
      name: selection.name.trim(),
      mimeType: (selection.mimeType || "").trim(),
    }))
    .filter((selection, index, all) => all.findIndex((candidate) => candidate.id === selection.id) === index);
}

/** Build the browser request for a selected cloud-file import. */
export function buildCloudImportRequest(provider: CloudImportProvider, roleId: string, selections: CloudImportSelection[]) {
  const normalizedRoleId = roleId.trim();
  const normalizedFiles = selectedCloudFiles(selections);
  const normalizedFileIds = normalizedFiles.map((file) => file.id);
  if (!normalizedRoleId || normalizedFileIds.length === 0) return null;

  return {
    endpoint: provider === "google" ? "/api/resume-screening/drive/import" : "/api/resume-screening/onedrive/import",
    init: {
      method: "POST" as const,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId: normalizedRoleId, fileIds: normalizedFileIds, files: normalizedFiles }),
    },
  };
}
