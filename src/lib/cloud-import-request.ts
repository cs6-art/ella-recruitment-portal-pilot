export type CloudImportProvider = "google" | "microsoft";

/** Build the browser request for a selected cloud-file import. */
export function buildCloudImportRequest(provider: CloudImportProvider, roleId: string, fileIds: string[]) {
  const normalizedRoleId = roleId.trim();
  const normalizedFileIds = [...new Set(fileIds.map((fileId) => fileId.trim()).filter(Boolean))];
  if (!normalizedRoleId || normalizedFileIds.length === 0) return null;

  return {
    endpoint: provider === "google" ? "/api/resume-screening/drive/import" : "/api/resume-screening/onedrive/import",
    init: {
      method: "POST" as const,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId: normalizedRoleId, fileIds: normalizedFileIds }),
    },
  };
}
