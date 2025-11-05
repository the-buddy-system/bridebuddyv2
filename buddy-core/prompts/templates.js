// TODO: Bride Buddy and future domains extend this core template.

export function buildPrompt({ persona = {}, extractionSchema = '', empathyDirectives = [], domainContext = '' }) {
  const {
    intro,
    role,
    conversationalApproach = [],
    task,
    userMessageLabel = 'USER MESSAGE',
    userMessage = '${message}',
    instructions = [],
    responseFormat = '',
    extractionRules = [],
    importantNotes = [],
    additionalSections = []
  } = persona;

  const lines = [];

  if (intro) {
    lines.push(intro);
  }

  if (role) {
    lines.push('', role);
  }

  if (conversationalApproach.length > 0) {
    lines.push('', 'CONVERSATIONAL APPROACH:', ...conversationalApproach.map(item => `- ${item}`));
  }

  if (domainContext) {
    lines.push('', domainContext);
  }

  if (task) {
    lines.push('', `TASK: ${task}`);
  }

  lines.push('', `${userMessageLabel}: "${userMessage}"`);

  if (instructions.length > 0) {
    lines.push('', 'INSTRUCTIONS:');
    instructions.forEach((instruction, index) => {
      lines.push(`${index + 1}. ${instruction}`);
    });
  }

  if (empathyDirectives.length > 0) {
    lines.push('', 'EMPATHY DIRECTIVES:');
    empathyDirectives.forEach(directive => {
      lines.push(`- ${directive}`);
    });
  }

  if (responseFormat) {
    lines.push('', responseFormat);
  }

  if (extractionSchema) {
    lines.push('', extractionSchema);
  }

  if (extractionRules.length > 0) {
    lines.push('', 'EXTRACTION RULES:');
    extractionRules.forEach(rule => {
      lines.push(`- ${rule}`);
    });
  }

  if (importantNotes.length > 0) {
    lines.push('', 'IMPORTANT:');
    importantNotes.forEach(note => {
      lines.push(`- ${note}`);
    });
  }

  if (additionalSections.length > 0) {
    additionalSections.forEach(section => {
      if (!section) return;
      lines.push('', section);
    });
  }

  return lines.join('\n');
}
