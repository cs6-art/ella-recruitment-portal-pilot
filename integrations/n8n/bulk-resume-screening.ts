import { workflow, node, trigger, newCredential, splitInBatches, nextBatch, languageModel, outputParser, ifElse, expr } from '@n8n/workflow-sdk';

const sheetDocument = '1J6qadoB07aliQWtV8uykEYW7ENjNOf0nsZ_iTt9g8KM';
const candidateWebhookUrl = '__CANDIDATE_WEBHOOK_URL__';
const webhookSecret = '__WEBHOOK_SECRET__';

const queueParameters = {
  resource: 'sheet',
  operation: 'append',
  authentication: 'serviceAccount',
  documentId: { __rl: true, mode: 'id', value: sheetDocument },
  sheetName: { __rl: true, mode: 'name', value: 'Bulk_Resume_Queue' },
  columns: { mappingMode: 'autoMapInputData', value: {} },
  options: { handlingExtraData: 'ignoreIt', cellFormat: 'USER_ENTERED', locationDefine: { values: { headerRow: 1 } } },
};
const queueCredentials = { googleApi: newCredential('Google Sheets Service Account') };

const schedule = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: { name: 'Bulk Resume Poller', parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } }, position: [240, 300] },
  output: [{}],
});

const readQueue = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Read Bulk Resume Queue',
    parameters: {
      resource: 'sheet',
      operation: 'read',
      authentication: 'serviceAccount',
      documentId: { __rl: true, mode: 'id', value: sheetDocument },
      sheetName: { __rl: true, mode: 'name', value: 'Bulk_Resume_Queue' },
      returnAllMatches: 'returnAllMatches',
      options: { dataLocationOnSheet: { values: { rangeDefinition: 'detectAutomatically', readRowsUntil: 'lastRowInSheet' } } },
    },
    credentials: { googleApi: newCredential('Google Sheets Service Account') },
    position: [540, 160],
  },
  output: [{ Drive_File_ID: 'drive-file-1', Status: 'Screened' }],
});

const findDrive = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Find New Drive Resumes',
    executeOnce: true,
    parameters: {
      resource: 'fileFolder',
      operation: 'search',
      authentication: 'serviceAccount',
      searchMethod: 'query',
      queryString: 'trashed = false',
      returnAll: true,
      filter: { folderId: { __rl: true, mode: 'id', value: expr('{{ $env.GOOGLE_BULK_RESUME_DRIVE_FOLDER_ID }}') }, whatToSearch: 'files', includeTrashed: false },
      options: { fields: ['id', 'name', 'mimeType', 'webViewLink'] },
    },
    credentials: { googleApi: newCredential('Google Drive Service Account') },
    position: [540, 440],
  },
  output: [{ id: 'drive-file-1', name: 'AC01 - Candidate Name.pdf', mimeType: 'application/pdf', webViewLink: 'https://drive.google.com/file/d/drive-file-1/view' }],
});

const selectFiles = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Select Unscreened Resumes',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const rows = $('Read Bulk Resume Queue').all().map((item) => item.json);
const latest = new Map();
const eventTime = (row) => Date.parse(String(row.Last_Updated || row.lastUpdated || row.Processed_At || row.processedAt || row.Discovered_At || row.discoveredAt || '')) || 0;
for (const row of rows) {
  const id = String(row.Drive_File_ID || row.driveFileId || '').trim();
  const roleId = String(row.Role_ID || row.roleId || '').trim().toLowerCase();
  const key = roleId + '|' + id;
  const previous = latest.get(key);
  if (id && (!previous || eventTime(row) >= previous.time)) latest.set(key, { status: String(row.Status || row.status || '').trim().toLowerCase(), time: eventTime(row) });
}
return $input.all().map((item) => item.json).filter((file) => {
  const name = String(file.name || '');
  const mime = String(file.mimeType || '').toLowerCase();
  const role = name.match(/^([A-Za-z]{2,12}\\d{1,8})\\s*[-_ ]/);
  const roleId = role ? role[1].toLowerCase() : '';
  const prior = latest.get(roleId + '|' + String(file.id || '').trim());
  return file.id && /\\.(pdf|docx)$/i.test(name) && (mime.includes('pdf') || mime.includes('word') || mime === 'application/octet-stream') && role && !['screened','processing','queued','failed','skipped'].includes(prior?.status || '');
}).map((file) => {
  const role = String(file.name).match(/^([A-Za-z]{2,12}\\d{1,8})\\s*[-_ ]/);
  const now = new Date().toISOString();
  return { driveFileId: String(file.id), driveFileName: String(file.name), driveFileUrl: String(file.webViewLink || ''), driveFileMimeType: String(file.mimeType || 'application/octet-stream'), roleId: role[1].toUpperCase(), status: 'Processing', discoveredAt: now, processingStartedAt: now, lastUpdated: now, attemptCount: '1' };
});`,
    },
    position: [840, 440],
  },
  output: [{ driveFileId: 'drive-file-1', driveFileName: 'AC01 - Candidate Name.pdf', driveFileUrl: 'https://drive.google.com/file/d/drive-file-1/view', driveFileMimeType: 'application/pdf', roleId: 'AC01', status: 'Processing', lastUpdated: '2026-08-14T00:00:00.000Z' }],
});

const batch = splitInBatches({ version: 3, config: { name: 'Process One Resume at a Time', parameters: { batchSize: 1 }, position: [1120, 440] } });
const claim = node({ type: 'n8n-nodes-base.googleSheets', version: 4.7, config: { name: 'Claim Resume for Processing', parameters: queueParameters, credentials: queueCredentials, position: [1400, 440] }, output: [{ driveFileId: 'drive-file-1', roleId: 'AC01', status: 'Processing' }] });

const download = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Download Drive Resume',
    parameters: { resource: 'file', operation: 'download', authentication: 'serviceAccount', fileId: { __rl: true, mode: 'id', value: expr('{{ $("Select Unscreened Resumes").item.json.driveFileId }}') }, options: { binaryPropertyName: 'data' } },
    credentials: { googleApi: newCredential('Google Drive Service Account') },
    position: [1680, 440],
  },
  output: [{ driveFileId: 'drive-file-1', roleId: 'AC01', driveFileName: 'AC01 - Candidate Name.pdf' }],
});

const extract = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Extract Resume Text',
    parameters: {
      method: 'POST',
      url: expr('{{ ($env.N8N_BULK_RESUME_PORTAL_BASE_URL || "https://ella-recruitment.mclinkgroup.com") + "/api/resume-screening/bulk/extract" }}'),
      sendQuery: true,
      specifyQuery: 'keypair',
      queryParameters: { parameters: [
        { name: 'fileName', value: expr('{{ $("Select Unscreened Resumes").item.json.driveFileName }}') },
        { name: 'driveFileId', value: expr('{{ $("Select Unscreened Resumes").item.json.driveFileId }}') },
        { name: 'roleId', value: expr('{{ $("Select Unscreened Resumes").item.json.roleId }}') },
      ] },
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [
        { name: 'X-Webhook-Secret', value: webhookSecret },
        { name: 'Content-Type', value: expr('{{ $("Select Unscreened Resumes").item.json.driveFileMimeType || "application/octet-stream" }}') },
      ] },
      sendBody: true,
      contentType: 'binaryData',
      inputDataFieldName: 'data',
      response: { responseFormat: 'json', neverError: false },
    },
    position: [1960, 440],
  },
  output: [{ success: true, driveFileId: 'drive-file-1', roleId: 'AC01', text: 'Candidate resume text...' }],
});

const parser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: { name: 'Candidate Metadata Parser', parameters: { schemaType: 'fromJson', jsonSchemaExample: '{ "candidate_name": "Alex Chen", "candidate_email": "alex@example.com", "preferred_mobile": "+639171234567", "applicant_country": "PH" }' }, position: [2320, 700] },
});
const model = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: { name: 'Bulk Resume AI Model', parameters: { model: { __rl: true, mode: 'list', value: 'gpt-5-mini', cachedResultName: 'gpt-5-mini' }, options: { responseFormat: 'json_object' } }, credentials: { openAiApi: newCredential('OpenAI') }, position: [2320, 900] },
});
const extractCandidate = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Extract Candidate Details',
    parameters: { promptType: 'define', text: expr("Extract contact details from one resume. Return only JSON with candidate_name, candidate_email, preferred_mobile, applicant_country. Use empty strings when absent. Do not guess. RESUME={{ $('Extract Resume Text').item.json.text }}"), hasOutputParser: true, options: { systemMessage: 'Extract only details explicitly present in the resume. Never invent contact information.', maxIterations: 1 } },
    subnodes: { model, outputParser: parser },
    position: [2240, 440],
  },
  output: [{ candidate_name: 'Alex Chen', candidate_email: 'alex@example.com', preferred_mobile: '+639171234567', applicant_country: 'PH' }],
});

const normalize = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Candidate Metadata',
    parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: `const value = $json.output ?? $json;
const data = typeof value === 'string' ? JSON.parse(value) : value;
const base = $('Select Unscreened Resumes').item.json;
const extracted = $('Extract Resume Text').item.json;
const resumeText = String(extracted.text || '');
const firstEmail = (resumeText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/ig) || [])[0] || '';
const phoneCandidates = resumeText.match(/(?:\\+|00)?\\d[\\d\\s().-]{7,}\\d/g) || [];
const country = String(data.applicant_country || data.applicantCountry || '').trim().toUpperCase();
const normalizePhone = (value) => { const raw = String(value || '').trim(); const digits = raw.replace(/\\D/g, ''); if (digits.length < 8 || digits.length > 15) return ''; if (raw.startsWith('+')) return '+' + digits; if (digits.startsWith('00')) return '+' + digits.slice(2); if (/^(63|65|60)/.test(digits)) return '+' + digits; if (country === 'PH' && digits.startsWith('0')) return '+63' + digits.slice(1); if (country === 'SG' && digits.length === 8) return '+65' + digits; if (country === 'MY' && digits.startsWith('0')) return '+60' + digits.slice(1); return ''; };
const firstPhone = phoneCandidates.map(normalizePhone).find(Boolean) || '';
const nameLines = resumeText.split(/\\r?\\n/).map((line) => String(line).replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 35);
const nameFromText = nameLines.map((line) => line.replace(/^(full\\s+name|candidate\\s+name|name)\\s*:\\s*/i, '')).find((line) => { const words = line.split(/\\s+/).filter((word) => /^[A-Za-z][A-Za-z'’-]*$/.test(word)); return words.length >= 2 && words.length <= 6 && !/@|https?:|\\d{3,}|^(resume|curriculum vitae|cv|profile|contact|experience|education|skills)\\b/i.test(line); }) || '';
const name = String(data.candidate_name || data.candidateName || nameFromText).trim();
const email = String(data.candidate_email || data.candidateEmail || firstEmail).trim().toLowerCase();
const mobile = String(data.preferred_mobile || data.preferredMobile || firstPhone).trim();
return { json: { ...base, resumeText, candidateName: name, candidateEmail: email, preferredMobile: mobile, applicantCountry: country, valid: Boolean(name && email.includes('@') && /^\\+[1-9]\\d{7,14}$/.test(mobile)) } };` },
    position: [2520, 440],
  },
  output: [{ driveFileId: 'drive-file-1', roleId: 'AC01', candidateName: 'Alex Chen', candidateEmail: 'alex@example.com', preferredMobile: '+639171234567', valid: true, resumeText: 'Candidate resume text...' }],
});
const hasDetails = ifElse({ version: 2.3, config: { name: 'Candidate Details Complete', parameters: { conditions: { options: { caseSensitive: false, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.valid }}'), operator: { type: 'boolean', operation: 'true' }, rightValue: true }], combinator: 'and' } }, position: [2800, 440] } });
const missing = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Prepare Missing Details Failure', parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: `return { json: { ...$json, status: 'Failed', errorMessage: 'Candidate name, email, or international mobile number was not found in the resume.', lastUpdated: new Date().toISOString() } };` }, position: [3080, 600] }, output: [{ driveFileId: 'drive-file-1', roleId: 'AC01', status: 'Failed', errorMessage: 'Candidate details missing' }] });
const saveMissing = node({ type: 'n8n-nodes-base.googleSheets', version: 4.7, config: { name: 'Save Missing Candidate Failure', parameters: queueParameters, credentials: queueCredentials, position: [3360, 600] }, output: [{ driveFileId: 'drive-file-1', roleId: 'AC01', status: 'Failed' }] });
const submit = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Submit Candidate to Screening Workflow',
    parameters: {
      method: 'POST',
      url: candidateWebhookUrl,
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'X-Webhook-Secret', value: webhookSecret }, { name: 'X-Idempotency-Key', value: expr('{{ $("Select Unscreened Resumes").item.json.driveFileId }}') }] },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ JSON.stringify({ eventType: "candidate_application_submitted", applicationId: "APP-BULK-" + $("Select Unscreened Resumes").item.json.driveFileId, roleId: $json.roleId, Role_ID: $json.roleId, jobTitle: "", department: "", candidate: { name: $json.candidateName, email: $json.candidateEmail, phone: $json.preferredMobile, preferredMobile: $json.preferredMobile, applicantCountry: $json.applicantCountry, resumeText: $json.resumeText, salaryExpectation: "", noticePeriod: "", availability: "", skillsAssessment: "", roleExpectations: "", applicationSource: "HR Manual Intake", consent: false }, submittedAt: $now.toISO(), source: "Bulk Google Drive Resume", applicationSource: "HR Manual Intake" }) }}'),
      response: { fullResponse: true, responseFormat: 'json', neverError: true },
    },
    position: [3080, 300],
  },
  output: [{ statusCode: 200, body: { success: true } }],
});
const evaluate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: 'Evaluate Screening Submission', parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: `const response = $json.body || $json;
const code = Number($json.statusCode || 0);
const base = $('Normalize Candidate Metadata').item.json;
const accepted = code >= 200 && code < 300 && response.success !== false;
return { json: { ...base, applicationId: 'APP-BULK-' + base.driveFileId, status: accepted ? 'Screened' : 'Failed', submissionAccepted: accepted, errorMessage: accepted ? '' : String(response.error || 'Candidate screening workflow rejected the resume.'), processedAt: accepted ? new Date().toISOString() : '', lastUpdated: new Date().toISOString() } };` }, position: [3360, 300] },
  output: [{ driveFileId: 'drive-file-1', roleId: 'AC01', status: 'Screened', submissionAccepted: true, applicationId: 'APP-BULK-drive-file-1' }],
});
const accepted = ifElse({ version: 2.3, config: { name: 'Screening Workflow Accepted', parameters: { conditions: { options: { caseSensitive: false, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.submissionAccepted }}'), operator: { type: 'boolean', operation: 'true' }, rightValue: true }], combinator: 'and' } }, position: [3640, 300] } });
const saveScreened = node({ type: 'n8n-nodes-base.googleSheets', version: 4.7, config: { name: 'Record Resume Screened', parameters: queueParameters, credentials: queueCredentials, position: [3920, 200] }, output: [{ driveFileId: 'drive-file-1', roleId: 'AC01', status: 'Screened' }] });
const saveFailed = node({ type: 'n8n-nodes-base.googleSheets', version: 4.7, config: { name: 'Record Screening Failure', parameters: queueParameters, credentials: queueCredentials, position: [3920, 500] }, output: [{ driveFileId: 'drive-file-1', roleId: 'AC01', status: 'Failed' }] });

export default workflow('bulk-resume-screening', 'Bulk Resume Screening')
  .add(schedule).to(readQueue)
  .to(findDrive).to(selectFiles)
  .to(batch.onDone(saveScreened).onEachBatch(
    claim.to(download).to(extract).to(normalize).to(hasDetails
      .onTrue(submit.to(evaluate.to(accepted.onTrue(saveScreened.to(nextBatch(batch))).onFalse(saveFailed.to(nextBatch(batch))))))
      .onFalse(missing.to(saveMissing.to(nextBatch(batch))))
  )));
