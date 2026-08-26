import { workflow, node, trigger, newCredential, languageModel, outputParser, expr } from '@n8n/workflow-sdk';

const webhookSecret = '__WEBHOOK_SECRET__';

const webhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Role Description Webhook',
    parameters: { httpMethod: 'POST', path: 'role-description-parser', authentication: 'none', responseMode: 'responseNode', options: { allowedOrigins: '*' } },
    position: [0, 112],
  },
  output: [{ body: { eventType: 'role_description_parse', jobDescriptionText: 'Example job description' }, headers: { 'x-webhook-secret': webhookSecret } }],
});

const validateWebhookSecret = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Parser Webhook Secret',
    parameters: {
      mode: 'runOnceForEachItem',
      language: 'javaScript',
      jsCode: 'const webhookInput = $("Role Description Webhook").item.json || {};\n'
        + 'const headers = webhookInput.headers || {};\n'
        + 'const provided = Object.entries(headers).find(([key]) => key.toLowerCase() === "x-webhook-secret")?.[1] || "";\n'
        + 'if (String(provided).trim() !== "' + webhookSecret + '") throw new Error("Unauthorized role description parser request.");\n'
        + 'return { json: $json };',
    },
    position: [224, 112],
  },
  output: [{ body: { eventType: 'role_description_parse', jobDescriptionText: 'Example job description' } }],
});

const parser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Role Draft JSON Parser',
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample: '{"role":{"requestType":"Staff Addition","department":"Engineering","jobTitle":"Software Engineer","numberOfVacancies":1,"reasonForRequest":"Expand the engineering team","jobDescription":"Full job description text","replacementEmployee":"","targetHiringDate":""},"recruitmentSetup":{"jobDescription":"Full job description text","screeningCriteria":"Evaluate relevant experience, skills, and role-specific outcomes.","requiredInterviewQuestion1":"Describe your most relevant experience for this role.","requiredInterviewQuestion2":"Tell us about a project that demonstrates the required skills.","requiredInterviewQuestion3":"How do you approach solving a difficult role-related problem?","requiredInterviewQuestion4":"How do you collaborate with stakeholders?","requiredInterviewQuestion5":"When could you start?","keywordsToLookFor":"role-specific skills","minimumYearsOfExperience":"","transferableSkillsAccepted":"Relevant adjacent experience","licenseOrCertificateRequired":"","salaryOrBudgetRange":"","earliestAvailabilityRule":"","evaluationFieldToggles":["communication_quality","problem_solving"],"customEvaluationFields":[],"postingChannels":[]}}',
    },
    position: [520, 400],
  },
});

const model = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'OpenAI Role Draft Model',
    parameters: { model: { __rl: true, mode: 'list', value: 'gpt-4.1-mini' }, options: {} },
    credentials: { openAiApi: newCredential('OpenAI') },
    position: [360, 640],
  },
});

const generateDraft = node({
  type: '@n8n/n8n-nodes-langchain.chainLlm',
  version: 1.9,
  config: {
    name: 'Generate Role Draft',
    parameters: {
      promptType: 'define',
      text: expr("You are an HR operations assistant. Convert the uploaded job description into a conservative recruitment draft. Return only the structured JSON requested by the parser. Never invent a person, email address, date, HOD availability, salary, posting channel, or credential. Use empty strings for optional fields when the document does not provide a value. For required role fields, use requestType exactly as Staff Addition unless the document clearly describes a replacement; infer the department from the role when it is explicit, otherwise use Not specified; use Position/Role to be confirmed by HR for an unavailable reasonForRequest. Do not leave requestType or department blank. Generate exactly five concise interview questions that test role-relevant evidence; do not ask about protected characteristics. The draft will be reviewed by HR before any publishing.\\n\\nJOB DESCRIPTION:\\n{{ $json.body.jobDescriptionText }}"),
      hasOutputParser: true,
    },
    subnodes: { model, outputParser: parser },
    position: [800, 112],
  },
  output: [{ output: { role: { requestType: 'Staff Addition', department: 'Engineering', jobTitle: 'Software Engineer', numberOfVacancies: 1, reasonForRequest: 'Expand the engineering team', jobDescription: 'Full job description text', replacementEmployee: '', targetHiringDate: '' }, recruitmentSetup: { jobDescription: 'Full job description text', screeningCriteria: 'Evaluate relevant experience, skills, and role-specific outcomes.', requiredInterviewQuestion1: 'Describe your most relevant experience for this role.', requiredInterviewQuestion2: 'Tell us about a project that demonstrates the required skills.', requiredInterviewQuestion3: 'How do you approach solving a difficult role-related problem?', requiredInterviewQuestion4: 'How do you collaborate with stakeholders?', requiredInterviewQuestion5: 'When could you start?', keywordsToLookFor: 'role-specific skills', minimumYearsOfExperience: '', transferableSkillsAccepted: 'Relevant adjacent experience', licenseOrCertificateRequired: '', salaryOrBudgetRange: '', earliestAvailabilityRule: '', evaluationFieldToggles: ['communication_quality', 'problem_solving'], customEvaluationFields: [], postingChannels: [] } } }],
});

const respond = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Return Role Draft',
    parameters: { respondWith: 'json', responseBody: expr('{{ { success: true, draft: ($json.output ?? $json) } }}') },
    position: [1080, 112],
  },
  output: [{ success: true, draft: { role: { jobTitle: 'Software Engineer' }, recruitmentSetup: { requiredInterviewQuestion1: 'Describe your most relevant experience for this role.' } } }],
});

export default workflow('ai-role-description-parser', 'AI Role Description Parser')
  .add(webhook)
  .to(validateWebhookSecret.to(generateDraft.to(respond)));
