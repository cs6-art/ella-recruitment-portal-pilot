import { workflow, node, trigger, newCredential, languageModel, outputParser, ifElse, expr } from '@n8n/workflow-sdk';

const sheetDocument = '1J6qadoB07aliQWtV8uykEYW7ENjNOf0nsZ_iTt9g8KM';
// The hosted n8n runtime denies workflow access to $env. Keep this aligned
// with the portal's N8N_CANDIDATE_APPLICATION_WEBHOOK_URL and the published
// Production webhook on McLink - Candidate Application Foundation.
const candidateWebhookUrl = 'https://n8n.srv1457709.hstgr.cloud/webhook/candidate-application';
const queueSchema = [
  'driveFileId', 'driveFileName', 'driveFileUrl', 'driveFileMimeType', 'roleId',
  'candidateName', 'candidateEmail', 'preferredMobile', 'applicantCountry', 'status',
  'applicationId', 'errorMessage', 'discoveredAt', 'processingStartedAt', 'processedAt',
  'attemptCount', 'lastUpdated', 'environment', 'is_uat', 'batchId', 'jobId',
].map((id) => ({ id, displayName: id, type: id === 'is_uat' ? 'boolean' : 'string', canBeUsedToMatch: id === 'jobId' }));

const queueParameters = {
  resource: 'sheet',
  // Portal submissions already reserve hashes before calling n8n. Keep the
  // terminal queue event append-only so concurrent intake executions do not
  // each perform another Sheets read to locate a matching row; the portal
  // collapses this event history by role + stable jobId/Drive identity.
  operation: 'append',
  authentication: 'serviceAccount',
  documentId: { __rl: true, mode: 'id', value: sheetDocument },
  sheetName: { __rl: true, mode: 'name', value: 'Bulk_Resume_Queue' },
  columns: { mappingMode: 'autoMapInputData', value: {}, schema: queueSchema },
  options: { handlingExtraData: 'ignoreIt', cellFormat: 'USER_ENTERED', locationDefine: { values: { headerRow: 1 } } },
};
const queueCredentials = { googleApi: newCredential('Google Sheets Service Account') };

const webhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: { name: 'Bulk Resume Upload Webhook', parameters: { httpMethod: 'POST', path: 'bulk-resume-upload', responseMode: 'responseNode', options: { allowedOrigins: '*' } }, position: [240, 300] },
  output: [{ body: { eventType: 'bulk_resume_uploaded', queueId: 'BULK-example', roleId: 'AC01', fileName: 'AC01 - Candidate.pdf', resumeText: 'Candidate resume text...' } }],
});

const normalize = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Check Bulk Upload Duplicate',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const body = $('Bulk Resume Upload Webhook').item.json.body || $('Bulk Resume Upload Webhook').item.json;
const text = (value) => String(value ?? '').trim();
const queueId = text(body.queueId);
const environment = text(body.environment) || 'production';
const isUat = body.is_uat === true || text(body.is_uat).toLowerCase() === 'true';
const batchId = text(body.batchId);
const jobId = text(body.jobId) || queueId;
if (!queueId || !text(body.roleId) || !text(body.resumeText)) throw new Error('Bulk resume payload is incomplete.');
const now = new Date().toISOString();
return [{ json: { skip: false, queueId, driveFileId: queueId, driveFileName: text(body.fileName), driveFileUrl: text(body.driveFileUrl), driveFileMimeType: text(body.mimeType), roleId: text(body.roleId), resumeText: text(body.resumeText), candidateName: text(body.candidateName), candidateEmail: text(body.candidateEmail).toLowerCase(), preferredMobile: text(body.preferredMobile), applicantCountry: text(body.applicantCountry).toUpperCase(), resumeFile: body.resumeFile || {}, applicationId: text(body.applicationId), environment, is_uat: isUat, batchId, jobId, status: 'Processing', discoveredAt: text(body.submittedAt) || now, processingStartedAt: now, processedAt: '', attemptCount: String(Number(body.attemptCount || 0) + 1), lastUpdated: now } }];`,
    },
    position: [800, 300],
  },
  output: [{ skip: false, queueId: 'BULK-example', driveFileId: 'BULK-example', driveFileName: 'AC01 - Candidate.pdf', roleId: 'AC01', resumeText: 'Candidate resume text...', status: 'Processing', attemptCount: '1' }],
});

const parser = outputParser({ type: '@n8n/n8n-nodes-langchain.outputParserStructured', version: 1.3, config: { name: 'Candidate Metadata Parser', parameters: { schemaType: 'fromJson', jsonSchemaExample: '{ "candidate_name": "Alex Chen", "candidate_email": "alex@example.com", "preferred_mobile": "+639171234567", "applicant_country": "PH" }' }, position: [1720, 560] } });
const model = languageModel({ type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', version: 1.3, config: { name: 'Bulk Upload AI Model', parameters: { model: { __rl: true, mode: 'list', value: 'gpt-5-mini', cachedResultName: 'gpt-5-mini' }, options: { responseFormat: 'json_object' } }, credentials: { openAiApi: newCredential('OpenAI') }, position: [1720, 760] } });
const extractCandidate = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Extract Candidate Details',
    parameters: { promptType: 'define', text: expr("Extract the candidate's full name, email, international mobile number, and country from this resume. Return only JSON with candidate_name, candidate_email, preferred_mobile, applicant_country. Use empty strings when absent and never guess. RESUME={{ $('Check Bulk Upload Duplicate').item.json.resumeText }}"), hasOutputParser: true, options: { systemMessage: 'Extract only contact details explicitly present in the resume. Never invent contact information.', maxIterations: 1 } },
    subnodes: { model, outputParser: parser },
    position: [1640, 300],
  },
  output: [{ candidate_name: 'Alex Chen', candidate_email: 'alex@example.com', preferred_mobile: '+639171234567', applicant_country: 'PH' }],
});

const prepareCandidate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Candidate Screening',
    parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: `const value = $json.output ?? $json;
const data = typeof value === 'string' ? JSON.parse(value) : value;
const base = $('Check Bulk Upload Duplicate').item.json;
const resumeText = String(base.resumeText || '');
const firstEmail = (resumeText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/ig) || [])[0] || '';
const phoneCandidates = resumeText.match(/(?:\\+|00)?\\d[\\d\\s().-]{7,}\\d/g) || [];
const country = String(data.applicant_country || data.applicantCountry || base.applicantCountry || '').trim().toUpperCase();
const normalizePhone = (value) => { const raw = String(value || '').trim(); const digits = raw.replace(/\\D/g, ''); if (digits.length < 8 || digits.length > 15) return ''; if (raw.startsWith('+')) return '+' + digits; if (digits.startsWith('00')) return '+' + digits.slice(2); if (/^(63|65|60)/.test(digits)) return '+' + digits; if (country === 'PH' && digits.startsWith('0')) return '+63' + digits.slice(1); if (country === 'SG' && digits.length === 8) return '+65' + digits; if (country === 'MY' && digits.startsWith('0')) return '+60' + digits.slice(1); return ''; };
const firstPhone = phoneCandidates.map(normalizePhone).find(Boolean) || '';
const nameLines = resumeText.split(/\\r?\\n/).map((line) => String(line).replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 35);
const nameFromText = nameLines.map((line) => line.replace(/^(full\\s+name|candidate\\s+name|name)\\s*:\\s*/i, '')).find((line) => { const words = line.split(/\\s+/).filter((word) => /^[A-Za-z][A-Za-z'’-]*$/.test(word)); return words.length >= 2 && words.length <= 6 && !/@|https?:|\\d{3,}|^(resume|curriculum vitae|cv|profile|contact|experience|education|skills)\\b/i.test(line); }) || '';
const name = String(data.candidate_name || data.candidateName || base.candidateName || nameFromText).trim();
const email = String(data.candidate_email || data.candidateEmail || base.candidateEmail || firstEmail).trim().toLowerCase();
const mobile = String(data.preferred_mobile || data.preferredMobile || base.preferredMobile || firstPhone).trim();
return { json: { ...base, candidateName: name, candidateEmail: email, preferredMobile: mobile, applicantCountry: country, valid: Boolean(name && email.includes('@') && /^\\+[1-9]\\d{7,14}$/.test(mobile)) } };` },
    position: [1920, 300],
  },
  output: [{ queueId: 'BULK-example', roleId: 'AC01', candidateName: 'Alex Chen', candidateEmail: 'alex@example.com', preferredMobile: '+639171234567', applicantCountry: 'PH', valid: true, resumeText: 'Candidate resume text...' }],
});
const validCandidate = ifElse({ version: 2.3, config: { name: 'Candidate Details Valid', parameters: { conditions: { options: { caseSensitive: false, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.valid }}'), operator: { type: 'boolean', operation: 'true' }, rightValue: true }], combinator: 'and' } }, position: [2200, 300] } });
const missing = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Prepare Candidate Details Failure', parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: `return { json: { ...$json, status: 'Failed', errorMessage: 'Candidate name, email, or international mobile number was not found in the resume.', lastUpdated: new Date().toISOString() } };` }, position: [2480, 520] }, output: [{ queueId: 'BULK-example', roleId: 'AC01', status: 'Failed', errorMessage: 'Candidate details missing' }] });
const saveMissing = node({ type: 'n8n-nodes-base.googleSheets', version: 4.7, config: { name: 'Record Candidate Details Failure', parameters: queueParameters, credentials: queueCredentials, position: [2760, 520] }, output: [{ queueId: 'BULK-example', roleId: 'AC01', status: 'Failed' }] });

const submit = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Submit Candidate to Screening Workflow',
    parameters: { method: 'POST', url: candidateWebhookUrl, sendHeaders: true, specifyHeaders: 'keypair', headerParameters: { parameters: [{ name: 'X-Idempotency-Key', value: expr('{{ $json.applicationId }}') }] }, sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: expr('{{ JSON.stringify({ eventType: "candidate_application_submitted", applicationId: $json.applicationId, roleId: $json.roleId, environment: $json.environment || "production", is_uat: $json.is_uat === true, batchId: $json.batchId || "", jobId: $json.jobId || $json.queueId, Role_ID: $json.roleId, jobTitle: "", department: "", candidate: { name: $json.candidateName, email: $json.candidateEmail, phone: $json.preferredMobile, preferredMobile: $json.preferredMobile, applicantCountry: $json.applicantCountry, resumeText: $json.resumeText, salaryExpectation: "", noticePeriod: "", availability: "", skillsAssessment: "", roleExpectations: "", applicationSource: "HR Manual Intake", consent: false }, resumeFile: $json.resumeFile, submittedAt: $now.toISO(), source: "Portal Bulk Upload", applicationSource: "HR Manual Intake" }) }}'), options: { response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } } } },
    position: [2480, 300],
  },
  output: [{ statusCode: 201, body: { success: true, applicationId: 'APP-BULK-example' } }],
});
const evaluate = node({ type: 'n8n-nodes-base.code', version: 2, config: { name: 'Evaluate Screening Submission', parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: `const response = $json.body || $json;
const code = Number($json.statusCode || 0);
const base = $('Prepare Candidate Screening').item.json;
const accepted = code >= 200 && code < 300 && response.success !== false;
const errorMessage = response.error || response.message || $json.error?.message || 'Candidate Foundation handoff failed before a response was received.';
return { json: { ...base, status: accepted ? 'Screened' : 'Failed', submissionAccepted: accepted, errorMessage: accepted ? '' : String(errorMessage), processedAt: accepted ? new Date().toISOString() : '', lastUpdated: new Date().toISOString() } };` }, position: [2760, 300] }, output: [{ queueId: 'BULK-example', roleId: 'AC01', status: 'Screened', submissionAccepted: true }] });
const accepted = ifElse({ version: 2.3, config: { name: 'Screening Workflow Accepted', parameters: { conditions: { options: { caseSensitive: false, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.submissionAccepted }}'), operator: { type: 'boolean', operation: 'true' }, rightValue: true }], combinator: 'and' } }, position: [3040, 300] } });
const saveScreened = node({ type: 'n8n-nodes-base.googleSheets', version: 4.7, config: { name: 'Record Resume Screened', parameters: queueParameters, credentials: queueCredentials, position: [3320, 200] }, output: [{ queueId: 'BULK-example', roleId: 'AC01', status: 'Screened' }] });
const saveFailed = node({ type: 'n8n-nodes-base.googleSheets', version: 4.7, config: { name: 'Record Screening Failure', parameters: queueParameters, credentials: queueCredentials, position: [3320, 420] }, output: [{ queueId: 'BULK-example', roleId: 'AC01', status: 'Failed' }] });
const respond = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.4,
  config: {
    name: 'Respond Bulk Resume Upload',
    parameters: { respondWith: 'json', responseBody: expr('{{ { success: true, queueId: $json.queueId || "", environment: $json.environment || "production", is_uat: $json.is_uat === true, batchId: $json.batchId || "", jobId: $json.jobId || $json.queueId || "", applicationId: $json.applicationId || "", status: $json.status || ($json.skip ? "Skipped" : "Processing"), errorMessage: $json.errorMessage || "" } }}'), options: { responseCode: 200 } },
    position: [3600, 300],
  },
  output: [{ success: true, queueId: 'BULK-example', status: 'Screened' }],
});

export default workflow('bulk-resume-upload-intake', 'Bulk Resume Upload Intake')
  .add(webhook)
  .to(normalize)
  .to(prepareCandidate)
  .to(validCandidate
    .onTrue(submit.to(evaluate.to(accepted.onTrue(saveScreened.to(respond)).onFalse(saveFailed.to(respond)))))
    .onFalse(missing.to(saveMissing.to(respond)))
  );
