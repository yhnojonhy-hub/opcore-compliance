export function flatMappedToSections(
  mapped: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  const sections: Record<string, Record<string, unknown>> = {};

  for (const [key, value] of Object.entries(mapped)) {
    if (!key.startsWith('sections.')) continue;
    const parts = key.replace(/^sections\./, '').split('.');
    let current = sections;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current[part] || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part] as Record<string, Record<string, unknown>>;
    }
    current[parts[parts.length - 1]] = value as Record<string, unknown>;
  }

  return sections;
}

export function sectionsToFlatMapped(
  sections: Record<string, Record<string, unknown>>,
  prefix = 'sections',
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [sectionKey, sectionValue] of Object.entries(sections)) {
    if (!sectionValue || typeof sectionValue !== 'object') continue;
    for (const [fieldKey, fieldValue] of Object.entries(sectionValue)) {
      result[`${prefix}.${sectionKey}.${fieldKey}`] = fieldValue;
    }
  }

  return result;
}
