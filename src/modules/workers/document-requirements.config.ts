import { DocumentType } from './schemas/worker-document.schema';

/**
 * Which document types a worker must have on file before she can submit for
 * review — keyed by country ISO code so this can differ per country later
 * without touching any service code, falling back to DEFAULT for any country
 * without its own entry.
 */
const REQUIRED_DOCUMENT_TYPES_BY_COUNTRY: Record<string, DocumentType[]> = {
  DEFAULT: [
    DocumentType.NATIONAL_ID_FRONT,
    DocumentType.NATIONAL_ID_BACK,
    DocumentType.CRIMINAL_RECORD,
  ],
};

export function getRequiredDocumentTypes(countryCode: string): DocumentType[] {
  return (
    REQUIRED_DOCUMENT_TYPES_BY_COUNTRY[countryCode] ?? REQUIRED_DOCUMENT_TYPES_BY_COUNTRY.DEFAULT
  );
}
